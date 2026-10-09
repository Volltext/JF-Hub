import { localBlobCount } from './blobs';
import { db } from './db';

/** kv-Einträge, die an einen Server-Stand oder ein Konto gebunden sind. */
const SYNC_KV_KEYS = [
  'protokolle.rev',
  'protokolle.epoch',
  'protokolle.serverRecords',
  'protokolle.serverCollections',
  'protokolle.conflicts',
  'records.seeded',
  'account',
  'directory',
  'push.endpoint',
];

/**
 * Entfernt alle abgeglichenen Daten und den Abgleich-Zustand von diesem Gerät (nach dem Abmelden bzw. bei Kontowechsel),
 * damit der nächste Nutzer weder fremde Daten sieht noch sie unter seinem Konto hochlädt.
 * Einstellungen, Ferien-Zwischenspeicher und die laufende Stoppuhr, Aufstellung und Wertung dieses Geräts bleiben.
 */
export async function wipeLocalData(): Promise<void> {
  await db.transaction('rw', [db.protokolle, db.ydocs, db.folders, db.members, db.sessions, db.tasks, db.clothing, db.clothingItems, db.runs, db.lineupTemplates, db.outbox, db.blobs, db.blobData, db.kv], async () => {
    await Promise.all([
      db.protokolle.clear(),
      db.ydocs.clear(),
      db.folders.clear(),
      db.members.clear(),
      db.sessions.clear(),
      db.tasks.clear(),
      db.clothing.clear(),
      db.clothingItems.clear(),
      db.runs.clear(),
      db.lineupTemplates.clear(),
      db.outbox.clear(),
      db.blobs.clear(),
      db.blobData.clear(),
      db.kv.bulkDelete(SYNC_KV_KEYS),
    ]);
  });
}

/**
 * Zahl der Einträge, die noch nicht auf dem Server sind (geht beim Abmelden verloren), Fotos und Dateien eingeschlossen.
 * Ein Protokoll, dessen Kopfdaten und Text beide ungesendet sind, zählt einmal.
 */
export async function unsyncedCount(): Promise<number> {
  const headers = (await db.protokolle.where('dirty').equals(1).primaryKeys()) as string[];
  const texts = (await db.ydocs.where('dirty').equals(1).primaryKeys()) as string[];
  const protocols = new Set([...headers, ...texts]).size;
  return protocols + (await db.folders.where('dirty').equals(1).count()) + (await db.outbox.count()) + (await localBlobCount());
}
