import { beforeEach, describe, expect, it } from 'vitest';
import { markRejected, markSynced, putLocalBlob, saveDownloaded } from './blobs';
import { db } from './db';
import { unsyncedCount, wipeLocalData } from './wipe';

beforeEach(async () => {
  await Promise.all([db.protokolle.clear(), db.folders.clear(), db.outbox.clear(), db.blobs.clear(), db.blobData.clear(), db.kv.clear()]);
});

const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 1]);
const mine = (id: string) => putLocalBlob({ id, kind: 'photo', mime: 'image/jpeg', name: '', data: bytes });

describe('Abmelden und nicht abgeglichene Daten', () => {
  it('Anhänge, die nur auf diesem Gerät liegen, zählen als nicht abgeglichen (auch abgelehnte)', async () => {
    expect(await unsyncedCount()).toBe(0);
    await mine('anh-000001');
    await mine('anh-000002');
    await mine('anh-000003');
    await markSynced('anh-000001');
    await markRejected('anh-000002', 'zu groß');
    await saveDownloaded({ id: 'kopie-0001', kind: 'photo', mime: 'image/jpeg', name: '' }, bytes); // Kopie des Servers
    expect(await unsyncedCount()).toBe(2);
  });

  it('Abmelden räumt alle Anhänge vom Gerät', async () => {
    await mine('anh-000001');
    await saveDownloaded({ id: 'kopie-0001', kind: 'photo', mime: 'image/jpeg', name: '' }, bytes);
    await wipeLocalData();
    expect(await db.blobs.count()).toBe(0);
    expect(await db.blobData.count()).toBe(0);
  });
});
