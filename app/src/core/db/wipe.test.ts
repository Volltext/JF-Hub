import { beforeEach, describe, expect, it } from 'vitest';
import { markRejected, markSynced, putLocalBlob, saveDownloaded } from './blobs';
import { newProtokoll } from '@/features/protokolle/model';
import { db } from './db';
import { unsyncedCount, wipeLocalData } from './wipe';

beforeEach(async () => {
  await Promise.all([db.protokolle.clear(), db.ydocs.clear(), db.folders.clear(), db.outbox.clear(), db.blobs.clear(), db.blobData.clear(), db.kv.clear()]);
});

const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 1]);
const mine = (id: string) => putLocalBlob({ id, kind: 'photo', mime: 'image/jpeg', name: '', data: bytes });

describe('Abmelden und nicht abgeglichene Daten', () => {
  it('Anhänge, die nur auf diesem Gerät liegen, zählen als nicht abgeglichen (auch abgelehnte, solange ein Protokoll sie braucht)', async () => {
    expect(await unsyncedCount()).toBe(0);
    await mine('anh-000001');
    await mine('anh-000002');
    await mine('anh-000003');
    await mine('anh-000004');
    await markSynced('anh-000001');
    await markRejected('anh-000002', 'zu groß');
    await markRejected('anh-000004', 'zu groß'); // abgelehnt, aber das Foto steht in keinem Protokoll mehr
    await db.protokolle.add({ ...newProtokoll(), dirty: 0, content: { type: 'doc', content: [{ type: 'photo', attrs: { blobId: 'anh-000002' } }] } });
    await saveDownloaded({ id: 'kopie-0001', kind: 'photo', mime: 'image/jpeg', name: '' }, bytes); // Kopie des Servers
    expect(await unsyncedCount()).toBe(2);
  });

  it('ungesendeter Text zählt mit, und ein Protokoll, dessen Kopfdaten und Text beide ungesendet sind, nur einmal', async () => {
    const both = { ...newProtokoll(), id: 'beide-00001' }; // Kopfdaten ungesendet (neu)
    const textOnly = { ...newProtokoll(), id: 'text-000001', dirty: 0 as const, rev: 3 };
    const clean = { ...newProtokoll(), id: 'sauber-0001', dirty: 0 as const, rev: 3 };
    await db.protokolle.bulkAdd([both, textOnly, clean]);
    await db.ydocs.bulkPut([
      { id: both.id, update: new Uint8Array([0, 0]), dirty: 1, seq: 1 },
      { id: textOnly.id, update: new Uint8Array([0, 0]), dirty: 1, seq: 1 },
      { id: clean.id, update: new Uint8Array([0, 0]), dirty: 0, seq: 0 },
    ]);
    expect(await unsyncedCount()).toBe(2);
  });

  it('Abmelden räumt auch die Texte vom Gerät', async () => {
    await db.ydocs.put({ id: 'text-000001', update: new Uint8Array([0, 0]), dirty: 1, seq: 1 });
    await wipeLocalData();
    expect(await db.ydocs.count()).toBe(0);
  });

  it('Abmelden räumt alle Anhänge vom Gerät', async () => {
    await mine('anh-000001');
    await saveDownloaded({ id: 'kopie-0001', kind: 'photo', mime: 'image/jpeg', name: '' }, bytes);
    await wipeLocalData();
    expect(await db.blobs.count()).toBe(0);
    expect(await db.blobData.count()).toBe(0);
  });
});
