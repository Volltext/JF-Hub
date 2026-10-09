import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HubDb } from './db';
import { evictBlobs, localBlobCount, markRejected, markSynced, pendingBlobs, putLocalBlob, readBlob, requeueBlobs, saveDownloaded } from './blobs';

let store: HubDb;
let n = 0;
beforeEach(() => {
  n++;
  store = new HubDb(`blobs-test-${n}`);
});
afterEach(async () => {
  await store.delete();
});

const bytes = (size: number, fill = 7) => new Uint8Array(size).fill(fill);
const photo = (data: Uint8Array, id?: string) => putLocalBlob({ ...(id ? { id } : {}), kind: 'photo', mime: 'image/jpeg', name: '', data }, store);

describe('lokaler Anhang-Speicher', () => {
  it('legt einen Anhang lokal ab und liest dieselben Bytes zurück', async () => {
    const meta = await photo(Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]));
    expect(meta).toMatchObject({ kind: 'photo', mime: 'image/jpeg', size: 6, state: 'local' });
    expect(meta.id).toBeTruthy();
    const back = await readBlob(meta.id, store);
    expect(back!.meta.id).toBe(meta.id);
    expect(Array.from(back!.data)).toEqual([0xff, 0xd8, 0xff, 1, 2, 3]);
    expect(await readBlob('gibt-es-nicht', store)).toBeUndefined();
  });

  it('Dateien tragen Namen und Typ', async () => {
    const meta = await putLocalBlob({ kind: 'file', mime: 'application/pdf', name: 'Plan.pdf', data: bytes(10) }, store);
    expect(await store.blobs.get(meta.id)).toMatchObject({ kind: 'file', mime: 'application/pdf', name: 'Plan.pdf', size: 10 });
  });

  it('wartende Anhänge: nur lokale, die der Server nicht abgelehnt hat', async () => {
    const a = await photo(bytes(5), 'anh-000001');
    const b = await photo(bytes(5), 'anh-000002');
    const c = await photo(bytes(5), 'anh-000003');
    await markSynced(a.id, store);
    await markRejected(b.id, 'zu groß', store);
    expect((await pendingBlobs(store)).map((x) => x.id)).toEqual([c.id]);
    expect(await localBlobCount(store)).toBe(2); // b und c liegen nur hier: beim Abmelden gingen sie verloren
    expect(await store.blobs.get(b.id)).toMatchObject({ state: 'local', rejected: 'zu groß' });
  });

  it('der Server meldet einen Anhang als fehlend: er wird erneut hochgeladen, wenn wir ihn haben', async () => {
    const a = await photo(bytes(5), 'anh-000001');
    const b = await photo(bytes(5), 'anh-000002');
    await markSynced(a.id, store);
    await markRejected(b.id, 'zu groß', store);
    expect(await requeueBlobs(['anh-000001', 'anh-000002', 'nur-beim-server'], store)).toBe(1); // der abgelehnte bleibt abgelehnt
    expect((await pendingBlobs(store)).map((x) => x.id)).toEqual(['anh-000001']);
  });

  it('Heruntergeladenes ist eine Kopie des Servers und überschreibt nie einen lokalen Anhang', async () => {
    const mine = await photo(bytes(5, 1), 'anh-000001');
    await saveDownloaded({ id: mine.id, kind: 'photo', mime: 'image/jpeg', name: '' }, bytes(5, 2), store);
    expect((await readBlob(mine.id, store))!.data[0]).toBe(1);
    expect((await store.blobs.get(mine.id))!.state).toBe('local');

    const saved = await saveDownloaded({ id: 'anh-000002', kind: 'file', mime: 'text/plain', name: 'a.txt' }, bytes(3, 9), store);
    expect(saved).toMatchObject({ state: 'synced', size: 3, name: 'a.txt' });
    expect((await readBlob('anh-000002', store))!.data[0]).toBe(9);
  });

  it('verdrängt die ältesten Kopien des Servers, nie Anhänge, die nur hier liegen', async () => {
    const old = await saveDownloaded({ id: 'alt-000001', kind: 'photo', mime: 'image/jpeg', name: '' }, bytes(100), store);
    const mid = await saveDownloaded({ id: 'mid-000001', kind: 'photo', mime: 'image/jpeg', name: '' }, bytes(100), store);
    const young = await saveDownloaded({ id: 'neu-000001', kind: 'photo', mime: 'image/jpeg', name: '' }, bytes(100), store);
    const mine = await photo(bytes(500), 'mein-00001');
    await store.blobs.update(old.id, { lastUsedAt: 1 });
    await store.blobs.update(mid.id, { lastUsedAt: 2 });
    await store.blobs.update(young.id, { lastUsedAt: 3 });

    expect(await evictBlobs(1_000, store)).toBe(0); // alles passt
    expect(await evictBlobs(250, store)).toBe(1); // 300 Byte Kopien: die älteste muss weg
    expect(await store.blobs.get(old.id)).toBeUndefined();
    expect(await store.blobData.get(old.id)).toBeUndefined();
    expect(await store.blobs.get(mid.id)).toBeDefined();
    expect(await evictBlobs(0, store)).toBe(2); // jetzt gar nichts mehr behalten
    expect(await store.blobs.get(young.id)).toBeUndefined();
    expect(await store.blobs.get(mine.id)).toBeDefined(); // der lokale Anhang bleibt, auch über dem Limit
    expect(await store.blobData.get(mine.id)).toBeDefined();
  });

  it('Lesen merkt die Nutzung, aber höchstens einmal pro Stunde', async () => {
    const meta = await photo(bytes(5));
    await store.blobs.update(meta.id, { lastUsedAt: 1 });
    await readBlob(meta.id, store);
    const first = (await store.blobs.get(meta.id))!.lastUsedAt;
    expect(first).toBeGreaterThan(1);
    await readBlob(meta.id, store);
    expect((await store.blobs.get(meta.id))!.lastUsedAt).toBe(first);
  });
});
