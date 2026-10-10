import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HubDb } from '@/core/db/db';
import { newProtokoll, type Protokoll } from '../model';
import { ANNA, BEN, TestServer, closeDevices, newDevice, textOf, typeInto } from './harness';
import { ensureBases, exchangeInBackground } from './background';
import { loadDoc, putLocal } from './yStore';
import type { ExchangeTransport } from './wire';

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: object[]) => ({ type: 'doc', content }) as never;

let server: TestServer;
let store: HubDb;
beforeEach(() => {
  server = new TestServer();
  store = newDevice('bg');
});
afterEach(closeDevices);

/** Ein Protokoll, das der Server kennt, und die lokale Zeile dazu (so, wie der Abgleich der Kopfdaten sie anlegt). */
async function known(id: string, text: string, over: Partial<Protokoll> = {}): Promise<string> {
  server.put({ id, title: id, ownerId: ANNA.id, shared: true, content: doc(para(text)) });
  await store.protokolle.add({ ...newProtokoll(), id, title: id, shared: true, dirty: 0, rev: server.row(id)!.rev, content: doc(para(text)), ...over });
  return id;
}
const run = (over: Parameters<typeof exchangeInBackground>[0] extends infer O ? Partial<O> : never = {}) => exchangeInBackground({ store, transport: server.transport(ANNA), ...over });

describe('ensureBases', () => {
  it('legt für nie gesendete Protokolle mit Inhalt die Basis an, für nichts sonst', async () => {
    await store.protokolle.add({ ...newProtokoll(), id: 'neu-000001', rev: 0, content: doc(para('Alt')) });
    await store.protokolle.add({ ...newProtokoll(), id: 'leer-00001', rev: 0, content: doc({ type: 'paragraph' }) });
    await store.protokolle.add({ ...newProtokoll(), id: 'bekannt-01', rev: 4, content: doc(para('Server')) });
    await store.protokolle.add({ ...newProtokoll(), id: 'weg-000001', rev: 0, deleted: 1, content: doc(para('weg')) });
    await store.protokolle.add({ ...newProtokoll(), id: 'kaputt-001', rev: 0, content: doc({ type: 'listItem', content: [para('lose')] }) });

    expect(await ensureBases(store)).toBe(1);
    expect((await store.ydocs.toArray()).map((r) => r.id)).toEqual(['neu-000001']);
    expect(await store.ydocs.get('neu-000001')).toMatchObject({ dirty: 1, created: true });
    expect(await ensureBases(store)).toBe(0); // wiederholbar, ohne etwas anzufassen
  });
});

describe('exchangeInBackground', () => {
  it('lädt die Texte neuer Protokolle vor (neueste zuerst) und merkt, bis zu welcher Revision das Gerät sie kennt', async () => {
    await known('alt-000001', 'Alt', { datum: '2026-01-01' });
    await known('neu-000001', 'Neu', { datum: '2026-09-01' });
    const r = await run({ maxDocs: 1 });
    expect(r).toMatchObject({ exchanged: 1, remaining: 1 });
    expect(await store.ydocs.get('neu-000001')).toBeDefined();
    expect(await store.ydocs.get('alt-000001')).toBeUndefined();

    const r2 = await run({ maxDocs: 1 });
    expect(r2).toMatchObject({ exchanged: 1, remaining: 0 });
    expect(textOf((await loadDoc('alt-000001', store))!.doc)).toBe('Alt');
    expect((await store.protokolle.get('alt-000001'))!.textRev).toBe(server.row('alt-000001')!.rev);
  });

  it('ohne etwas zu tun entsteht keine Anfrage', async () => {
    await known('doc-000001', 'Text');
    await run();
    const calls = server.exchanges.length;
    const r = await run();
    expect(r).toMatchObject({ exchanged: 0, remaining: 0 });
    expect(server.exchanges.length).toBe(calls);
  });

  it('holt, was sich beim Server geändert hat, und sendet ungesendete eigene Änderungen', async () => {
    const id = await known('doc-000001', 'Basis');
    await run();
    // jemand anderes schreibt
    const ben = newDevice('ben-bg');
    await ben.protokolle.add({ ...(await store.protokolle.get(id))! });
    const benTransport = server.transport(BEN);
    const benDoc = (await loadDoc(id, store))!.doc;
    typeInto(benDoc, ' von Ben');
    await benTransport({ docs: [{ id, update: Buffer.from(Y.encodeStateAsUpdate(benDoc, (await store.ydocs.get(id))!.serverSv)).toString('base64'), sv: Buffer.from(Y.encodeStateVector(benDoc)).toString('base64') }] });
    await store.protokolle.update(id, { rev: server.row(id)!.rev }); // wie der Abgleich der Kopfdaten ihn melden würde
    // und hier wurde ohne Netz geschrieben
    const local = (await loadDoc(id, store))!.doc;
    const updates: Uint8Array[] = [];
    local.on('update', (u: Uint8Array) => updates.push(u));
    typeInto(local, ' lokal');
    typeInto(local, '!');
    await putLocal(id, Y.mergeUpdates(updates), store);

    const r = await run();
    expect(r).toMatchObject({ exchanged: 1, sent: 1 });
    expect(await store.ydocs.get(id)).toMatchObject({ dirty: 0 });
    const merged = textOf((await loadDoc(id, store))!.doc);
    expect(merged).toContain('von Ben');
    expect(merged).toContain('!');
    expect(JSON.stringify(JSON.parse(server.row(id)!.content))).toContain('von Ben');
    expect(JSON.stringify(JSON.parse(server.row(id)!.content))).toContain('!');
  });

  it('lässt Texte in Ruhe, die gerade in einem Editor offen sind', async () => {
    await known('offen-0001', 'Text');
    await known('zu-00000001', 'Text');
    const r = await run({ isOpen: (id) => id === 'offen-0001' });
    expect(r.exchanged).toBe(1);
    expect(await store.ydocs.get('offen-0001')).toBeUndefined();
    expect(await store.ydocs.get('zu-00000001')).toBeDefined();
  });

  it('nicht umgestellte (legacy) und gelöschte Protokolle werden übergangen', async () => {
    await known('alt-000001', 'Text', { legacy: true });
    await known('weg-000001', 'Text', { deleted: 1 });
    expect(await run()).toMatchObject({ exchanged: 0, remaining: 0 });
  });

  it('nie gesendete Protokolle ohne Zustand (rev 0) werden nicht vorgeladen', async () => {
    await store.protokolle.add({ ...newProtokoll(), id: 'neu-000001', rev: 0, content: doc() });
    expect(await run()).toMatchObject({ exchanged: 0 });
  });

  describe('Antworten des Servers', () => {
    const stub = (status: string, extra: Record<string, unknown> = {}): ExchangeTransport => async (req) => ({ docs: req.docs.map((d) => ({ id: d.id, status: status as never, ...extra })) });

    /** Schreibt in ein vorgeladenes Protokoll, ohne zu senden. */
    async function makeUnsent(id: string): Promise<void> {
      const d = (await loadDoc(id, store))!.doc;
      const updates: Uint8Array[] = [];
      d.on('update', (u: Uint8Array) => updates.push(u));
      typeInto(d, ' ungesendet');
      await putLocal(id, Y.mergeUpdates(updates), store);
      await store.protokolle.update(id, { rev: server.row(id)!.rev + 1 }); // der Server hat sich bewegt, damit der Austausch dran ist
    }
    async function withUnsent(id: string): Promise<void> {
      await known(id, 'Basis');
      await run();
      await makeUnsent(id);
    }

    it('gelöscht oder zurückgezogen: Ungesendetes bleibt als Kopie, der Zustand wird verworfen', async () => {
      await withUnsent('doc-000001');
      const r = await run({ transport: stub('gone') });
      expect(r.copies).toBe(1);
      expect(await store.ydocs.get('doc-000001')).toBeUndefined();
      const copy = (await store.protokolle.filter((p) => p.title.endsWith('(lokale Fassung)')).toArray())[0]!;
      expect(copy).toMatchObject({ rev: 0, dirty: 1, shared: false });
      expect(JSON.stringify(copy.content)).toContain('ungesendet');
    });

    it('gelöscht, nichts Ungesendetes: keine Kopie', async () => {
      await known('doc-000001', 'Basis');
      await run();
      await store.protokolle.update('doc-000001', { rev: 99 });
      expect((await run({ transport: stub('gone') })).copies).toBe(0);
      expect(await store.protokolle.filter((p) => p.title.endsWith('(lokale Fassung)')).count()).toBe(0);
    });

    it('legacy: das Protokoll wird als nur lesbar gemerkt', async () => {
      await known('doc-000001', 'Text');
      await run({ transport: stub('legacy') });
      expect((await store.protokolle.get('doc-000001'))!.legacy).toBe(true);
    });

    it('exists: eigene Fassung als Kopie, danach holt der nächste Lauf den Zustand des Servers', async () => {
      await withUnsent('doc-000001');
      const r = await run({ transport: stub('exists') });
      expect(r).toMatchObject({ copies: 1, remaining: 1 });
      expect(await store.ydocs.get('doc-000001')).toBeUndefined();
      expect((await store.protokolle.get('doc-000001'))!.textRev).toBeUndefined();
      const again = await run();
      expect(again.exchanged).toBe(1);
      expect(textOf((await loadDoc('doc-000001', store))!.doc)).toBe('Basis');
    });

    it('abgelehnt (zu groß): wird vermerkt und nicht erneut gesendet', async () => {
      await withUnsent('doc-000001');
      const r = await run({ transport: stub('rejected', { reason: 'Protokoll zu groß' }) });
      expect(r.rejected).toBe(1);
      expect(await store.ydocs.get('doc-000001')).toMatchObject({ dirty: 1, rejected: 'Protokoll zu groß' });
      const calls = server.exchanges.length;
      await run();
      expect(server.exchanges.length).toBe(calls);
    });

    it('„Alles neu abgleichen“ (retryRejected) sendet einen abgelehnten Text noch einmal; sonst bleibt er liegen', async () => {
      await withUnsent('doc-000001');
      await run({ transport: stub('rejected', { reason: 'Serverfehler' }) });
      const calls = server.exchanges.length;
      await run();
      expect(server.exchanges.length).toBe(calls); // der normale Lauf lässt ihn liegen
      await run({ retryRejected: true });
      expect(server.exchanges.length).toBe(calls + 1);
      expect(await store.ydocs.get('doc-000001')).toMatchObject({ dirty: 0 });
      expect(JSON.stringify(JSON.parse(server.row('doc-000001')!.content))).toContain('ungesendet');
    });

    it('ein Lauf schickt nur so viel auf einmal, wie ein Proxy mit kleinem Anfragelimit annimmt; der Rest kommt im nächsten Lauf', async () => {
      const ids = ['doc-000001', 'doc-000002', 'doc-000003'];
      for (const id of ids) await known(id, 'Basis');
      await run(); // alle vorladen
      for (const id of ids) await makeUnsent(id);
      const before = server.exchanges.length;
      const r = await run({ maxRequestChars: 1 }); // jedes Dokument für sich
      expect(server.exchanges.length).toBe(before + 1);
      expect(server.exchanges[before]!.docs).toHaveLength(1);
      expect(r).toMatchObject({ sent: 1, remaining: 2 });
      const r2 = await run({ maxRequestChars: 1 });
      const r3 = await run({ maxRequestChars: 1 });
      expect(r2.sent + r3.sent).toBe(2);
      expect(await store.ydocs.where('dirty').equals(1).count()).toBe(0);
    });

    it('resync: beim nächsten Mal geht der ganze Zustand hoch', async () => {
      await withUnsent('doc-000001');
      await run({ transport: stub('resync') });
      expect((await store.ydocs.get('doc-000001'))!.serverSv).toBeUndefined();
      expect(await run()).toMatchObject({ sent: 1 });
      expect(JSON.stringify(JSON.parse(server.row('doc-000001')!.content))).toContain('ungesendet');
    });

    it('die Datenbank des Servers wurde ersetzt: nichts wird angewendet', async () => {
      await known('doc-000001', 'Text');
      const r = await run({ transport: async () => ({ reset: true, docs: [] }) });
      expect(r.reset).toBe(true);
      expect(await store.ydocs.count()).toBe(0);
    });

    it('der Server liefert nicht alles (Budget): der Rest bleibt für den nächsten Lauf', async () => {
      for (let i = 0; i < 22; i++) await known(`doc-${String(i).padStart(6, '0')}`, `Text ${i}`);
      const r = await run({ maxDocs: 22 });
      expect(r.exchanged).toBe(20); // der Server nimmt höchstens 20 Dokumente je Anfrage
      expect(r.remaining).toBe(2);
      expect((await run({ maxDocs: 22 })).remaining).toBe(0);
      expect(await store.ydocs.count()).toBe(22);
    });

    it('Anhänge, die der Server vermisst, werden gemeldet', async () => {
      await known('doc-000001', 'Text');
      const r = await run({ transport: stub('ok', { missingBlobs: ['foto-0001'] }) });
      expect(r.missingBlobs).toEqual(['foto-0001']);
    });
  });
});
