import { db } from './db';

/** kv-Einträge, die an einen Server-Stand oder ein Konto gebunden sind. */
const SYNC_KV_KEYS = [
  'protokolle.rev',
  'protokolle.epoch',
  'protokolle.serverRecords',
  'protokolle.serverCollections',
  'records.seeded',
  'account',
  'directory',
  'push.endpoint',
];

/**
 * Entfernt alle abgeglichenen Daten und den Abgleich-Zustand von diesem Gerät (nach dem Abmelden bzw. bei Kontowechsel),
 * damit der nächste Nutzer weder fremde Daten sieht noch sie unter seinem Konto hochlädt.
 * Einstellungen, Ferien-Zwischenspeicher und die Wettkampf-Daten dieses Geräts bleiben.
 */
export async function wipeLocalData(): Promise<void> {
  await db.transaction('rw', [db.protokolle, db.folders, db.members, db.sessions, db.tasks, db.clothing, db.clothingItems, db.outbox, db.kv], async () => {
    await Promise.all([
      db.protokolle.clear(),
      db.folders.clear(),
      db.members.clear(),
      db.sessions.clear(),
      db.tasks.clear(),
      db.clothing.clear(),
      db.clothingItems.clear(),
      db.outbox.clear(),
      db.kv.bulkDelete(SYNC_KV_KEYS),
    ]);
  });
}

/** Zahl der Einträge, die noch nicht auf dem Server sind (geht beim Abmelden verloren). */
export async function unsyncedCount(): Promise<number> {
  return (await db.protokolle.where('dirty').equals(1).count()) + (await db.folders.where('dirty').equals(1).count()) + (await db.outbox.count());
}
