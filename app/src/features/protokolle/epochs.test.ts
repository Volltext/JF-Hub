import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubDb } from '@/core/db/db';
import { restoreFromFile } from '../../../../server/src/backup';
import type { SyncUser } from '../../../../server/src/sync';

/**
 * Die Registrierung offener Sitzungen (`collab/session.ts`) gilt je Seite. Hier laufen mehrere Geräte und Tabs im selben Prozess; sie
 * antwortet deshalb mit der Sitzung des Geräts oder Tabs, der gerade abgleicht (wie in `collab/fuzz.test.ts`).
 */
const acting = vi.hoisted(() => ({ session: undefined as undefined | { id: string } }));
vi.mock('./collab/session', async () => {
  const actual = await vi.importActual<typeof import('./collab/session')>('./collab/session');
  return {
    ...actual,
    isSessionOpen: (id: string) => acting.session?.id === id,
    getOpenSession: (id: string) => (acting.session?.id === id ? acting.session : undefined),
    openSessions: () => (acting.session ? [acting.session] : []),
  };
});

import { ANNA, BEN, TestServer, closeDevices, newDevice, textOf, typeInto } from './collab/harness';
import { openProtocol } from './collab/openPlan';
import type { CollabSession } from './collab/session';
import { loadDoc, markRejected } from './collab/yStore';

/**
 * Die Datenbank des Servers wird ersetzt (Wiederherstellung, neuer leerer Server), während mehrere Geräte und Tabs den Text eines
 * Protokolls in unterschiedlichem Zustand haben: Der Server hat danach genau einen Text, und was ein Gerät noch nicht abgeben konnte,
 * liegt als Kopie „(lokale Fassung)“ vor.
 */
let server: TestServer;
let anna: HubDb;
let ben: HubDb;

beforeEach(() => {
  server = new TestServer();
  anna = newDevice('anna');
  ben = newDevice('ben');
});
afterEach(closeDevices);

const para = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const doc = (...content: object[]) => ({ type: 'doc', content }) as never;
type Json = { content?: { content?: { text?: string }[] }[] };
const textOfJson = (json: unknown): string => ((json as Json).content ?? []).map((b) => (b.content ?? []).map((t) => t.text ?? '').join('')).join('\n');
const serverText = (id: string): string => textOfJson(JSON.parse(server.row(id)!.content));
/** Die Texte aller Kopien „(lokale Fassung)“ auf diesem Gerät. */
const copiesOf = async (store: HubDb): Promise<string[]> =>
  (await store.protokolle.filter((p) => p.title.endsWith('(lokale Fassung)')).toArray()).map((p) => textOfJson(p.content));

async function open(store: HubDb, user: SyncUser, id: string): Promise<CollabSession> {
  const r = await openProtocol(id, { store, transport: server.transport(user), hasServer: async () => true, session: { visible: () => false, intervalMs: 1e9, maxBackoffMs: 1e9 } });
  if (r.kind !== 'edit') throw new Error(`nicht zu öffnen: ${r.reason}`);
  return r.session;
}

/** Gleicht ein Gerät oder einen Tab ab; `session` ist dessen offene Sitzung (falls eine). */
async function syncAs(store: HubDb, user: SyncUser, session?: CollabSession) {
  acting.session = session;
  try {
    return await server.syncOf(store, user);
  } finally {
    acting.session = undefined;
  }
}

/** Ein veröffentlichtes Protokoll, das beide Geräte kennen (mit Text). */
async function sharedDoc(text = 'Basis'): Promise<string> {
  const id = server.put({ id: 'doc-00001', title: 'Sitzung', ownerId: ANNA.id, shared: true, content: doc(para(text)) });
  await server.syncOf(anna, ANNA);
  await server.syncOf(ben, BEN);
  return id;
}

/** Ein Gerät, das den Text noch nicht vorgeladen hat: Es kennt das Protokoll nur als Schnappschuss in der Liste. */
async function forgetText(store: HubDb, id: string): Promise<void> {
  await store.ydocs.delete(id);
  await store.protokolle.update(id, { textRev: undefined });
}

describe('neuer, leerer Server und Geräte, die den Text nur zum Teil haben', () => {
  for (const order of ['Anna zuerst', 'Ben zuerst'] as const) {
    it(`Ben kennt das Protokoll nur als Schnappschuss, Anna hat den Zustand (${order}): der Text steht danach einmal auf dem Server`, async () => {
      const id = await sharedDoc('Basis');
      await forgetText(ben, id);
      server.replaceDatabase();
      const first = order === 'Anna zuerst' ? ([anna, ANNA] as const) : ([ben, BEN] as const);
      const second = order === 'Anna zuerst' ? ([ben, BEN] as const) : ([anna, ANNA] as const);
      for (let i = 0; i < 3; i++) await syncAs(...first);
      for (let i = 0; i < 3; i++) await syncAs(...second);
      for (let i = 0; i < 2; i++) {
        await syncAs(anna, ANNA);
        await syncAs(ben, BEN);
      }
      expect(serverText(id)).toBe('Basis');
      expect(textOf((await loadDoc(id, anna))!.doc)).toBe('Basis');
      expect(textOf((await loadDoc(id, ben))!.doc)).toBe('Basis');
    });
  }

  it('Anna merkt den Wechsel zuerst, Ben (nur Schnappschuss) lädt seine Basis hoch, danach lädt Anna ihren Zustand hoch: kein doppelter Text', async () => {
    const id = await sharedDoc('Basis');
    await forgetText(ben, id);
    server.replaceDatabase();
    await syncAs(anna, ANNA); // erkennt den Wechsel; der Server kennt das Protokoll nicht, der Zustand geht im nächsten Lauf hoch
    await syncAs(ben, BEN);
    await syncAs(ben, BEN); // baut aus dem Schnappschuss eine Basis und lädt sie hoch
    expect(serverText(id)).toBe('Basis');
    await syncAs(anna, ANNA); // Annas Zustand hat eine andere Geschichte als die Basis: Er darf nicht mit ihr zusammengeführt werden
    for (let i = 0; i < 3; i++) {
      await syncAs(ben, BEN);
      await syncAs(anna, ANNA);
    }
    expect(serverText(id)).toBe('Basis');
    expect(textOf((await loadDoc(id, anna))!.doc)).toBe('Basis');
    expect(textOf((await loadDoc(id, ben))!.doc)).toBe('Basis');
    // Annas Fassung ging nicht verloren, aber auch nicht doppelt in das Protokoll: Sie liegt als Kopie vor.
    expect(await copiesOf(anna)).toEqual(['Basis']);
  });

  it('eine Wiederherstellung kennt ein Protokoll nicht (nach der Sicherung angelegt): Es entsteht einmal neu, beide Geräte haben es sauber', async () => {
    const id = await sharedDoc('Basis');
    const q = server.put({ id: 'doc-00002', title: 'Neu nach Sicherung', ownerId: ANNA.id, shared: true, content: doc(para('Nur nach der Sicherung')) });
    await server.syncOf(anna, ANNA);
    await server.syncOf(ben, BEN);
    expect(await anna.ydocs.get(q)).toBeDefined();
    expect(await ben.ydocs.get(q)).toBeDefined();
    server.replaceDatabase({ restored: true });
    server.put({ id, title: 'Sitzung', ownerId: ANNA.id, shared: true, content: doc(para('Basis')) });
    for (let i = 0; i < 3; i++) {
      await syncAs(ben, BEN);
      await syncAs(anna, ANNA);
    }
    expect(serverText(q)).toBe('Nur nach der Sicherung');
    const texts = (server.db.prepare('SELECT content FROM protocols').all() as { content: string }[]).map((r) => textOfJson(JSON.parse(r.content)));
    expect(texts.filter((t) => t.includes('Nur nach der Sicherung'))).toHaveLength(1);
  });
});

describe('der Zustand eines offenen Editors wird ersetzt', () => {
  it('zwei Tabs: Der andere Tab holt nach einer Wiederherstellung (fremde Geschichte) den Zustand neu, der offene Editor führt ihn nicht mit seinem zusammen', async () => {
    const id = await sharedDoc('Basis');
    const a = await open(anna, ANNA, id);
    a.start();
    typeInto(a.doc, ' mehr');
    await a.flush();
    await a.exchangeNow();
    expect(serverText(id)).toBe('Basis mehr');

    server.replaceDatabase({ restored: true });
    server.put({ id, title: 'Sitzung', ownerId: ANNA.id, shared: true, content: doc(para('Basis mehr')) }); // wie eine Sicherung aus 2.x: andere Geschichte
    const tab2 = new HubDb(anna.name);
    try {
      await syncAs(tab2, ANNA); // dieser Tab hat keinen Editor offen: Er verwirft den Zustand und holt den des Servers
      await a.exchangeNow();
      expect(a.getInfo().status).toBe('replaced');
      typeInto(a.doc, '!');
      await a.flush();
      await a.exchangeNow();
      await syncAs(ben, BEN);
      expect(serverText(id)).toBe('Basis mehr');
      expect(textOf((await loadDoc(id, ben))!.doc)).toBe('Basis mehr');
      // Der Zustand des anderen Tabs wurde nicht durch den veralteten Editor verunreinigt.
      expect(textOf((await loadDoc(id, tab2))!.doc)).toBe('Basis mehr');
      await a.destroy();
      expect(await copiesOf(anna)).toEqual(['Basis mehr!']); // was der Editor noch geschrieben hat, geht nicht verloren
    } finally {
      tab2.close();
    }
  });

  it('dasselbe mit einer Sicherung mit gleicher Geschichte (3.0): Die Wiederherstellung gilt, der offene Editor spielt seinen neueren Text nicht wieder ein', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jfh-epochs-'));
    try {
      const id = await sharedDoc('Basis');
      server.db.prepare("INSERT INTO users(id, username, displayName, role, passwordHash, createdAt) VALUES('admin-1','admin','Admin','admin','x',1)").run();
      const file = join(dir, 'sicherung.sqlite');
      server.db.exec(`VACUUM INTO '${file}'`); // Stand „Basis“
      const a = await open(anna, ANNA, id);
      a.start();
      typeInto(a.doc, ' mehr');
      await a.flush();
      await a.exchangeNow();
      expect(serverText(id)).toBe('Basis mehr');

      restoreFromFile(server.db, file); // gewollt: zurück auf „Basis“
      expect(serverText(id)).toBe('Basis');
      const tab2 = new HubDb(anna.name);
      try {
        await syncAs(tab2, ANNA);
        expect(textOf((await loadDoc(id, tab2))!.doc)).toBe('Basis');
        await a.exchangeNow();
        expect(a.getInfo().status).toBe('replaced');
        typeInto(a.doc, '!');
        await a.flush();
        await a.exchangeNow();
        expect(serverText(id)).toBe('Basis');
        await a.destroy();
        expect(await copiesOf(anna)).toEqual(['Basis mehr!']);
      } finally {
        tab2.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ein Tab: Der Editor eines noch nicht vorgeladenen Protokolls (leerer Schnappschuss) holt den Text; ersetzt danach eine Wiederherstellung den Server, ist das erkennbar', async () => {
    const id = server.put({ id: 'doc-00001', title: 'Sitzung', ownerId: ANNA.id, shared: true, content: doc(para(''), para('')) });
    await server.syncOf(anna, ANNA);
    await server.syncOf(ben, BEN);
    await forgetText(anna, id); // der Text ist hier noch nicht vorgeladen
    const b = await open(ben, BEN, id);
    typeInto(b.doc, 'Von Ben');
    await b.flush();
    await b.exchangeNow();
    await b.destroy();
    expect(serverText(id)).toContain('Von Ben');

    const a = await open(anna, ANNA, id); // Schnappschuss leer, kein Zustand
    a.start();
    await a.exchangeNow(); // holt „Von Ben“ vom Server
    expect(textOf(a.doc)).toContain('Von Ben');
    expect((await anna.ydocs.get(id))?.dirty).toBe(0);

    server.replaceDatabase({ restored: true });
    server.put({ id, title: 'Sitzung', ownerId: ANNA.id, shared: true, content: doc(para('Von Ben')) }); // andere Geschichte
    await syncAs(anna, ANNA, a); // erkennt den Wechsel und verwirft den Zustand
    await a.exchangeNow();
    expect(a.getInfo().status).toBe('replaced');
    typeInto(a.doc, '!');
    await a.flush();
    await a.exchangeNow();
    expect(serverText(id)).toBe('Von Ben');
    await a.destroy();
    expect((await copiesOf(anna)).join('|')).toContain('!');
  });
});

describe('vom Server abgelehnter Text und eine ersetzte Datenbank', () => {
  it('ein abgelehnter Text bekommt bei einem neuen, leeren Server einen neuen Versuch und bleibt nicht für immer vorgemerkt', async () => {
    const id = await sharedDoc('Basis');
    const a = await open(anna, ANNA, id);
    typeInto(a.doc, ' neu');
    await a.flush();
    await a.destroy();
    await markRejected(id, 'zu groß', (await anna.ydocs.get(id))!.seq, anna); // wie nach der Antwort „abgelehnt“
    expect((await anna.ydocs.get(id))?.rejected).toBe('zu groß');
    server.replaceDatabase();
    for (let i = 0; i < 4; i++) await syncAs(anna, ANNA);
    expect(serverText(id)).toBe('Basis neu');
    expect(await anna.ydocs.where('dirty').equals(1).count()).toBe(0);
  });

  it('ebenso ein abgelehnter Kopfdatensatz (Titel zu lang, ungültig …)', async () => {
    const id = await sharedDoc('Basis');
    await anna.protokolle.update(id, { title: 'Neuer Titel', dirty: 1, rejected: 'ungültig' });
    server.replaceDatabase();
    for (let i = 0; i < 4; i++) await syncAs(anna, ANNA);
    expect(server.row(id)?.title).toBe('Neuer Titel');
    expect((await anna.protokolle.get(id))?.dirty).toBe(0);
  });
});
