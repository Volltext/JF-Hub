import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { putLocalBlob } from '@/core/db/blobs';
import type { HubDb } from '@/core/db/db';
import { findBlob } from '../../../../server/src/blobs';
import type { SyncUser } from '../../../../server/src/sync';
import { ensureBlob } from './blobSync';
import { ANNA, BEN, TestServer, closeDevices, newDevice, textOf, typeInto } from './collab/harness';
import { openProtocol } from './collab/openPlan';
import type { CollabSession } from './collab/session';
import { loadDoc } from './collab/yStore';
import { migrateYjs } from '../../../../server/src/collab/migrate';
import { newProtokoll, type Protokoll } from './model';
import { saveHeader } from './repo';

/**
 * Zwei Geräte gleichen sich gegen den echten Server-Code ab (`applySync` und `exchange` mit einer Datenbank im Speicher):
 * Client- und Server-Regeln für das gemeinsame Bearbeiten stehen in einem Test zusammen.
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

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: object[]) => ({ type: 'doc', content }) as never;
const serverText = (id: string): string => {
  const j = JSON.parse(server.row(id)!.content) as { content?: { content?: { text?: string }[] }[] };
  return (j.content ?? []).map((b) => (b.content ?? []).map((t) => t.text ?? '').join('')).join('\n');
};

async function open(store: HubDb, user: SyncUser, id: string, session: Parameters<typeof openProtocol>[1]['session'] = {}): Promise<CollabSession> {
  const r = await openProtocol(id, { store, transport: server.transport(user), hasServer: async () => true, session });
  if (r.kind !== 'edit') throw new Error(`nicht zu öffnen: ${r.reason}`);
  return r.session;
}
const exchange = async (...ss: CollabSession[]) => {
  for (const s of ss) {
    await s.flush();
    await s.exchangeNow();
  }
};

/** Ein veröffentlichtes Protokoll, das beide Geräte kennen. */
async function sharedDoc(text = 'Basis'): Promise<string> {
  const id = server.put({ id: 'doc-00001', title: 'Sitzung', ownerId: ANNA.id, shared: true, content: doc(para(text)) });
  await server.syncOf(anna, ANNA);
  await server.syncOf(ben, BEN);
  expect((await ben.protokolle.get(id))?.title).toBe('Sitzung');
  expect(await ben.ydocs.get(id)).toBeDefined(); // der Text ist schon vorgeladen
  return id;
}

describe('zwei Geräte, ein veröffentlichtes Protokoll: der Text', () => {
  it('gleichzeitiges Tippen läuft zusammen, ohne Kopie und ohne Verlust', async () => {
    const id = await sharedDoc();
    const a = await open(anna, ANNA, id);
    const b = await open(ben, BEN, id);
    typeInto(a.doc, ' Anna');
    typeInto(b.doc, ' Ben');
    await exchange(a, b, a);
    expect(textOf(a.doc)).toBe(textOf(b.doc));
    expect(textOf(a.doc)).toContain('Anna');
    expect(textOf(a.doc)).toContain('Ben');
    expect(serverText(id)).toBe(textOf(a.doc));
    expect(server.db.prepare('SELECT COUNT(*) AS n FROM protocols').get()).toEqual({ n: 1 }); // keine Konfliktkopie
  });

  it('Ben schreibt ohne Netz, Anna inzwischen mit: beim Zusammenführen bleibt beides, ohne Konflikt', async () => {
    const id = await sharedDoc();
    // Ben: der Editor ist offen, die Verbindung bricht ab
    const b = await open(ben, BEN, id);
    server.offline = true;
    typeInto(b.doc, ' (Ben im Zug)');
    await exchange(b);
    expect(b.getInfo().offline).toBe(true);
    await b.destroy();
    // Anna schreibt, sobald der Server wieder da ist
    server.offline = false;
    const a = await open(anna, ANNA, id);
    typeInto(a.doc, ' (Anna im Büro)');
    await exchange(a);
    await a.destroy();
    // Ben ist wieder online, ohne Editor: der Abgleich im Hintergrund führt zusammen
    await server.syncOf(ben, BEN);
    await server.syncOf(anna, ANNA);
    const merged = serverText(id);
    expect(merged).toContain('Ben im Zug');
    expect(merged).toContain('Anna im Büro');
    expect(textOf((await loadDoc(id, ben))!.doc)).toBe(merged);
    expect(textOf((await loadDoc(id, anna))!.doc)).toBe(merged);
    expect(await ben.ydocs.get(id)).toMatchObject({ dirty: 0 });
    expect(server.db.prepare('SELECT COUNT(*) AS n FROM protocols').get()).toEqual({ n: 1 });
  });

  it('eine Person auf zwei Geräten verhält sich wie zwei Personen; die Mitschreibenden nennen sie nur einmal und nie sich selbst', async () => {
    const id = await sharedDoc();
    const handy = newDevice('anna-handy');
    await server.syncOf(handy, ANNA);
    const a1 = await open(anna, ANNA, id);
    const a2 = await open(handy, ANNA, id);
    const b = await open(ben, BEN, id);
    typeInto(a1.doc, ' vom Rechner');
    typeInto(a2.doc, ' vom Handy');
    await exchange(a1, a2, a1, b, a1);
    expect(textOf(a1.doc)).toBe(textOf(a2.doc));
    expect(a1.getInfo().peers).toEqual([BEN.id]);
    expect(b.getInfo().peers.sort()).toEqual([ANNA.id]);
  });

  it('jedes Gerät sendet nur, was dem Server fehlt (nicht den ganzen Text bei jedem Takt)', async () => {
    const id = await sharedDoc('x'.repeat(2000));
    const a = await open(anna, ANNA, id);
    await exchange(a);
    const calls = server.exchanges.length;
    typeInto(a.doc, '!');
    await exchange(a);
    const sent = server.exchanges.slice(calls).flatMap((r) => r.docs).find((d) => d.update)!;
    expect(Buffer.from(sent.update!, 'base64').length).toBeLessThan(100);
  });
});

describe('zwei Geräte: Kopfdaten', () => {
  const edit = (store: HubDb, id: string, patch: Parameters<typeof saveHeader>[2]) => saveHeader(store, id, patch);

  it('verschiedene Felder zweier Geräte gelten beide', async () => {
    const id = await sharedDoc();
    await edit(anna, id, { title: 'Neuer Titel' });
    await edit(ben, id, { ort: 'Gerätehaus' });
    await server.syncOf(anna, ANNA);
    await server.syncOf(ben, BEN);
    await server.syncOf(anna, ANNA);
    for (const store of [anna, ben]) expect(await store.protokolle.get(id)).toMatchObject({ title: 'Neuer Titel', ort: 'Gerätehaus', dirty: 0 });
    expect(server.db.prepare("SELECT COUNT(*) AS n FROM protocols WHERE title LIKE '%Konflikt%'").get()).toEqual({ n: 0 });
  });

  it('dasselbe Feld: die jüngere Änderung gewinnt, auf beiden Geräten', async () => {
    const id = await sharedDoc();
    await edit(anna, id, { title: 'Annas Titel' });
    await new Promise((r) => setTimeout(r, 5));
    await edit(ben, id, { title: 'Bens Titel' }); // später
    await server.syncOf(ben, BEN); // Ben ist zuerst beim Server
    await server.syncOf(anna, ANNA);
    await server.syncOf(ben, BEN);
    expect((await anna.protokolle.get(id))!.title).toBe('Bens Titel');
    expect((await ben.protokolle.get(id))!.title).toBe('Bens Titel');
    expect(server.row(id)!.title).toBe('Bens Titel');
  });

  it('weitertippen im Titel während des Abgleichs geht nicht verloren', async () => {
    const id = await sharedDoc();
    await edit(anna, id, { title: 'v1' });
    let typed = false;
    const res = await (async () => {
      const { performSync } = await import('./sync');
      const { applySync } = await import('../../../../server/src/sync');
      return performSync(
        async (req) => {
          const out = applySync(server.db, JSON.parse(JSON.stringify(req)), ANNA);
          if (!typed) {
            typed = true;
            await edit(anna, id, { title: 'v2' }); // der Nutzer tippt weiter, während die Anfrage unterwegs ist
          }
          return { ...JSON.parse(JSON.stringify(out)), api: 4 };
        },
        {},
        anna,
        server.blobsOf(ANNA),
        server.transport(ANNA),
      );
    })();
    expect(res.pushed).toBeGreaterThan(0);
    expect(await anna.protokolle.get(id)).toMatchObject({ title: 'v2', dirty: 1 }); // die neuere Eingabe wartet auf den nächsten Abgleich
    await server.syncOf(anna, ANNA);
    expect(server.row(id)!.title).toBe('v2');
    expect(await anna.protokolle.get(id)).toMatchObject({ title: 'v2', dirty: 0 });
  });

  it('eine verlorene Antwort führt bei der Wiederholung zu keinem zweiten Protokoll', async () => {
    const { performSync } = await import('./sync');
    const { applySync } = await import('../../../../server/src/sync');
    const p: Protokoll = { ...newProtokoll('', true), title: 'Neu' };
    await anna.protokolle.add(p);
    await expect(
      performSync(
        async (req) => {
          applySync(server.db, JSON.parse(JSON.stringify(req)), ANNA); // der Server hat gespeichert …
          throw new Error('Antwort verloren'); // … die Antwort kommt nicht an
        },
        {},
        anna,
      ),
    ).rejects.toThrow();
    expect(await anna.protokolle.get(p.id)).toMatchObject({ dirty: 1, rev: 0 });
    await server.syncOf(anna, ANNA);
    expect(server.db.prepare('SELECT COUNT(*) AS n FROM protocols').get()).toEqual({ n: 1 });
    expect(await anna.protokolle.get(p.id)).toMatchObject({ dirty: 0 });
  });
});

describe('zurückgezogen, gelöscht, ersetzt', () => {
  it('zieht Anna das Protokoll zurück, während Ben ungesendeten Text hat, bleibt Bens Text als private Kopie', async () => {
    const id = await sharedDoc();
    const b = await open(ben, BEN, id);
    typeInto(b.doc, ' Bens Ergänzung');
    await b.flush();
    await b.destroy();
    await saveHeader(anna, id, { shared: false });
    await server.syncOf(anna, ANNA); // privat
    await server.syncOf(ben, BEN); // Ben erfährt es
    expect(await ben.protokolle.get(id)).toBeUndefined();
    expect(await ben.ydocs.get(id)).toBeUndefined();
    const copy = (await ben.protokolle.toArray()).find((p) => p.title === 'Sitzung (lokale Fassung)');
    expect(copy).toMatchObject({ shared: false });
    expect(textOf((await loadDoc(copy!.id, ben))!.doc)).toBe('Basis Bens Ergänzung');
    // die Kopie geht als neues, privates Protokoll von Ben hoch
    await server.syncOf(ben, BEN);
    const sent = server.db.prepare("SELECT ownerId, shared, content FROM protocols WHERE title = 'Sitzung (lokale Fassung)'").get() as { ownerId: string; shared: number; content: string };
    expect(sent).toMatchObject({ ownerId: BEN.id, shared: 0 });
    expect(sent.content).toContain('Bens Ergänzung');
  });

  it('wird die Datenbank des Servers ersetzt (ältere Sicherung), gilt der Stand des Servers, ungesendetes bleibt als Kopie', async () => {
    const id = await sharedDoc('Stand der Sicherung');
    const a = await open(anna, ANNA, id);
    typeInto(a.doc, ' und später geschrieben');
    await exchange(a);
    await a.destroy();
    await server.syncOf(ben, BEN);
    expect(textOf((await loadDoc(id, ben))!.doc)).toBe('Stand der Sicherung und später geschrieben');

    // Anna schreibt noch etwas, das den Server nicht mehr erreicht, dann wird die ältere Sicherung eingespielt
    const a2 = await open(anna, ANNA, id);
    server.offline = true;
    typeInto(a2.doc, ' (nur hier)');
    await exchange(a2);
    await a2.destroy();
    server.offline = false;
    const rows = server.db.prepare('SELECT * FROM protocols').all();
    server.replaceDatabase();
    server.put({ id, title: 'Sitzung', ownerId: ANNA.id, shared: true, content: doc(para('Stand der Sicherung')) });
    expect(rows.length).toBe(1);

    await server.syncOf(anna, ANNA); // erkennt die neue Datenbank
    await server.syncOf(ben, BEN);
    // beide haben den Stand der Sicherung; die Texte nach der Sicherung sind weg, wie bei einer Wiederherstellung gewollt
    expect(textOf((await loadDoc(id, ben))!.doc)).toBe('Stand der Sicherung');
    expect(textOf((await loadDoc(id, anna))!.doc)).toBe('Stand der Sicherung');
    // aber was Anna nicht mehr abgeben konnte, ist nicht verloren
    const copy = (await anna.protokolle.toArray()).find((p) => p.title.endsWith('(lokale Fassung)'))!;
    expect(textOf((await loadDoc(copy.id, anna))!.doc)).toBe('Stand der Sicherung und später geschrieben (nur hier)');
  });

  it('auch ein vollständiger Abgleich („Alles neu abgleichen“) als erster nach dem Einspielen einer Sicherung verwirft den lokalen Zustand', async () => {
    const id = await sharedDoc('Stand der Sicherung');
    const a = await open(anna, ANNA, id);
    typeInto(a.doc, ' NACH DER SICHERUNG');
    await exchange(a);
    await a.destroy();
    server.replaceDatabase();
    server.put({ id, title: 'Sitzung', ownerId: ANNA.id, shared: true, content: doc(para('Stand der Sicherung')) });
    await server.syncOf(anna, ANNA, { full: true }); // since = 0: Der Server meldet keinen Wechsel der Datenbank, die Kennung verrät ihn
    expect(textOf((await loadDoc(id, anna))!.doc)).toBe('Stand der Sicherung');
    // weiterschreiben bringt den Text der Wiederherstellung nicht zurück
    const again = await open(anna, ANNA, id);
    typeInto(again.doc, '!');
    await exchange(again);
    expect(serverText(id)).toBe('Stand der Sicherung!');
  });

  it('wird die Datenbank ersetzt, während ein Editor offen ist: er lädt neu, auch der noch nicht gesicherte Text aus dem Speicher des Editors bleibt als Kopie', async () => {
    const id = await sharedDoc('Stand der Sicherung');
    let replaced = 0;
    const a = await open(anna, ANNA, id, { onReplaced: () => replaced++ });
    a.start();
    typeInto(a.doc, ' (noch nicht gesichert)'); // steht nur im Speicher des Editors
    server.replaceDatabase();
    server.put({ id, title: 'Sitzung', ownerId: ANNA.id, shared: true, content: doc(para('Stand der Sicherung')) });

    await server.syncOf(anna, ANNA); // erkennt die neue Datenbank: Kopie, Zustand verworfen
    const copy = (await anna.protokolle.toArray()).find((p) => p.title.endsWith('(lokale Fassung)'))!;
    expect(textOf((await loadDoc(copy.id, anna))!.doc)).toBe('Stand der Sicherung (noch nicht gesichert)');

    await a.exchangeNow(); // der Editor merkt, dass sein Zustand verworfen wurde
    expect(a.getInfo().status).toBe('replaced');
    expect(replaced).toBe(1);
    await a.destroy();
    expect(await anna.ydocs.get(id)).toBeUndefined(); // kein Zustand aus den Resten des Speichers

    // neu geöffnet zeigt er den Stand des Servers
    const again = await open(anna, ANNA, id);
    expect(textOf(again.doc)).toBe('Stand der Sicherung');
    // und das Original hat den Text der neuen Datenbank als Schnappschuss
    expect(JSON.stringify((await anna.protokolle.get(id))!.content)).not.toContain('noch nicht gesichert');
  });

  it('der Server verliert den Text eines Protokolls, das nur dieses Gerät kennt: er geht mit dem ganzen Zustand hoch', async () => {
    const id = await sharedDoc();
    const a = await open(anna, ANNA, id);
    typeInto(a.doc, ' nur Anna');
    await exchange(a);
    await a.destroy();
    server.replaceDatabase(); // der Server kennt das Protokoll nicht mehr
    await server.syncOf(anna, ANNA);
    await server.syncOf(anna, ANNA);
    expect(serverText(id)).toBe('Basis nur Anna');
  });
});

describe('Protokolle aus der Zeit vor 3.0.0', () => {
  const legacyDoc = (title = 'Alt') => ({ ...newProtokoll('', true), title, rev: 0, content: doc(para('Aus 2.3.0')) });

  it('ein nie gesendetes Protokoll mit Text geht mit seiner Basis hoch; der Server hat den Text', async () => {
    const p = legacyDoc();
    await anna.protokolle.add(p);
    await server.syncOf(anna, ANNA);
    expect(serverText(p.id)).toBe('Aus 2.3.0');
    expect(await anna.ydocs.get(p.id)).toMatchObject({ dirty: 0 });
    await server.syncOf(ben, BEN);
    expect(textOf((await loadDoc(p.id, ben))!.doc)).toBe('Aus 2.3.0');
  });

  it('dieselbe Sicherung auf zwei Geräten (gleiche Kennung, beide nie gesendet): der Text wird nicht doppelt', async () => {
    const p = legacyDoc();
    // beide Geräte haben dasselbe Protokoll mit Kennung und Inhalt, zum Beispiel aus derselben Sicherung der App
    await anna.protokolle.add(p);
    await ben.protokolle.add({ ...p });
    await server.syncOf(anna, ANNA);
    await server.syncOf(ben, BEN); // Ben ist Betreuer: sieht es, weil veröffentlicht; eigener Text mit anderer Geschichte
    await server.syncOf(ben, BEN); // der Zustand des Servers wird nachgeholt
    const text = serverText(p.id);
    expect(text).toBe('Aus 2.3.0'); // nicht „Aus 2.3.0Aus 2.3.0“
    // Bens Fassung liegt als Kopie vor, der Zustand des Servers gilt
    const copy = (await ben.protokolle.toArray()).find((x) => x.title === 'Alt (lokale Fassung)');
    expect(copy).toBeDefined();
    expect(textOf((await loadDoc(p.id, ben))!.doc)).toBe('Aus 2.3.0');
  });
});

describe('Kopfdaten eines Protokolls, das der Server beim Update umgestellt hat', () => {
  const tick = (ms = 8) => new Promise((r) => setTimeout(r, ms));
  const ID = 'doc-00001';

  /** Ein Protokoll aus der Zeit vor 3.0.0: Der Server hat keine Feldzeiten, die Geräte auch nicht. */
  async function migrated(): Promise<void> {
    server.put({ id: ID, title: 'Sitzung', ownerId: ANNA.id, shared: true, ymode: 0, content: doc(para('Basis')) });
    migrateYjs(server.db);
    await server.syncOf(anna, ANNA);
    await server.syncOf(ben, BEN);
    await tick();
  }
  /** Schreibt Text im offenen Protokoll und schließt es wieder (die Änderungszeit der Zeile rückt vor). */
  async function typeAndClose(store: HubDb, user: SyncUser, text: string): Promise<void> {
    const s = await open(store, user, ID);
    typeInto(s.doc, text);
    await s.flush();
    await s.destroy();
    await tick();
  }

  it('wer nur Text schreibt und dann den Titel ändert, überstimmt den Ort nicht, den ein anderer inzwischen gesetzt hat', async () => {
    await migrated();
    await saveHeader(ben, ID, { ort: 'Halle' });
    await server.syncOf(ben, BEN);
    await tick();
    // Annas Gerät kennt Bens Ort noch nicht: Sie schreibt Text, danach ändert sie den Titel
    await typeAndClose(anna, ANNA, ' Annas Text');
    await saveHeader(anna, ID, { title: 'Annas Titel' });
    await server.syncOf(anna, ANNA);
    await server.syncOf(ben, BEN);
    expect(server.row(ID)).toMatchObject({ title: 'Annas Titel', ort: 'Halle' });
    for (const store of [anna, ben]) expect(await store.protokolle.get(ID)).toMatchObject({ title: 'Annas Titel', ort: 'Halle', dirty: 0 });
  });

  it('ein Gerät mit veraltetem Stand macht ein zurückgezogenes Protokoll nicht wieder öffentlich, wenn es Text schreibt und etwas anderes ändert', async () => {
    await migrated();
    const handy = newDevice('anna-handy');
    await server.syncOf(handy, ANNA);
    await tick();
    await saveHeader(anna, ID, { shared: false }); // am Laptop zurückgezogen
    await server.syncOf(anna, ANNA);
    await tick();
    await typeAndClose(handy, ANNA, ' vom Handy'); // das Handy weiß davon noch nichts
    await saveHeader(handy, ID, { ort: 'Zeltplatz' });
    await server.syncOf(handy, ANNA);
    expect(server.row(ID)).toMatchObject({ shared: 0, ort: 'Zeltplatz' });
    expect(await handy.protokolle.get(ID)).toMatchObject({ shared: false, ort: 'Zeltplatz' });
    // Ben sieht das Protokoll nicht mehr
    await server.syncOf(ben, BEN);
    expect(await ben.protokolle.get(ID)).toBeUndefined();
  });
});

describe('Fotos zwischen zwei Geräten', () => {
  const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6]);
  const photoDoc = (blobId: string, shared: boolean): Protokoll => ({
    ...newProtokoll('', shared),
    title: 'Mit Foto',
    rev: 0,
    content: doc({ type: 'paragraph' }, { type: 'photo', attrs: { blobId, mime: 'image/jpeg', w: 8, h: 6, caption: 'Teich' } }),
  });
  const info = { id: 'foto-0001', kind: 'photo' as const, mime: 'image/jpeg', name: '' };
  const addPhoto = (store: HubDb) => putLocalBlob({ id: 'foto-0001', kind: 'photo', mime: 'image/jpeg', name: '', data: JPEG }, store);

  it('ein veröffentlichtes Foto kommt bei Ben an, sobald er es anschaut', async () => {
    await addPhoto(anna);
    await anna.protokolle.add(photoDoc('foto-0001', true));
    await server.syncOf(anna, ANNA);
    expect(await anna.blobs.get('foto-0001')).toMatchObject({ state: 'synced' });

    await server.syncOf(ben, BEN);
    expect(await ben.protokolle.count()).toBe(1);
    expect(await ben.blobs.count()).toBe(0); // geladen wird erst beim Anschauen
    const got = await ensureBlob(info, server.blobsOf(BEN), ben);
    expect(Array.from(got.data)).toEqual(Array.from(JPEG));
    expect(await ben.blobs.get('foto-0001')).toMatchObject({ state: 'synced' });
  });

  it('ein privates Foto bekommt niemand sonst', async () => {
    await addPhoto(anna);
    await anna.protokolle.add(photoDoc('foto-0001', false));
    await server.syncOf(anna, ANNA);
    await expect(ensureBlob(info, server.blobsOf(BEN), ben)).rejects.toMatchObject({ reason: 'missing' });
  });

  it('zieht Anna das Protokoll zurück, ist das Foto für Ben weg, für sie nicht', async () => {
    await addPhoto(anna);
    const p = photoDoc('foto-0001', true);
    await anna.protokolle.add(p);
    await server.syncOf(anna, ANNA);
    await saveHeader(anna, p.id, { shared: false });
    await server.syncOf(anna, ANNA);
    await expect(ensureBlob(info, server.blobsOf(BEN), ben)).rejects.toMatchObject({ reason: 'missing' });
    expect(Array.from((await ensureBlob(info, server.blobsOf(ANNA), anna)).data)).toEqual(Array.from(JPEG));
  });

  it('wird die Server-Datenbank ersetzt, lädt das Gerät das Foto mit dem Protokoll erneut hoch', async () => {
    await addPhoto(anna);
    await anna.protokolle.add(photoDoc('foto-0001', true));
    await server.syncOf(anna, ANNA);
    server.replaceDatabase(); // zum Beispiel eine ältere Sicherung eingespielt: das Foto ist weg

    await server.syncOf(anna, ANNA); // erkennt die neue Datenbank, merkt das Protokoll zum erneuten Senden vor
    await server.syncOf(anna, ANNA); // sendet es samt Text; der Server meldet das fehlende Foto
    expect(findBlob(server.db, 'foto-0001', ANNA.id)).toBeUndefined();
    await server.syncOf(anna, ANNA); // lädt es hoch
    expect(findBlob(server.db, 'foto-0001', ANNA.id)).toBeDefined();
    expect((await anna.blobs.get('foto-0001'))!.state).toBe('synced');
  });

  it('ein Server, der das Foto ablehnt, lässt den Rest des Abgleichs durch', async () => {
    await putLocalBlob({ id: 'kein-jpeg-1', kind: 'photo', mime: 'image/jpeg', name: '', data: Uint8Array.from([1, 2, 3, 4, 5]) }, anna);
    await anna.protokolle.add(photoDoc('kein-jpeg-1', true));
    const res = await server.syncOf(anna, ANNA);
    expect(res.blobs).toEqual({ uploaded: 0, rejected: 1, failed: 0 });
    expect(await anna.protokolle.where('dirty').equals(1).count()).toBe(0);
    expect(await anna.blobs.get('kein-jpeg-1')).toMatchObject({ state: 'local' });
    expect((await anna.blobs.get('kein-jpeg-1'))!.rejected).toContain('JPEG');
  });
});

// Y bleibt eingebunden, auch wenn einzelne Tests es nicht brauchen (Typ für die Hilfsfunktionen oben).
export type _Doc = Y.Doc;
