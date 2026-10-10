import { localBlobCount } from './blobs';
import { db, type HubDb } from './db';

/**
 * Zählt, wie oft die lokalen Daten dieses Geräts gelöscht wurden (Abmelden, Kontowechsel). Er gehört nicht zu den Einträgen, die dabei
 * verschwinden: Ein Abgleich, der vor dem Löschen begann und danach eine Antwort bekommt, erkennt daran, dass er nichts mehr einspielen darf
 * (sonst kämen Daten des vorigen Kontos zurück).
 */
const WIPE_COUNT_KEY = 'device.wipes';

export async function wipeCount(store: HubDb = db): Promise<number> {
  return ((await store.kv.get(WIPE_COUNT_KEY))?.value as number | undefined) ?? 0;
}

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
    await db.kv.put({ key: WIPE_COUNT_KEY, value: (await wipeCount()) + 1 });
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
