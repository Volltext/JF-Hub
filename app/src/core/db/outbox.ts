import { db, type SyncCollection } from './db';

export const SYNC_COLLECTIONS: SyncCollection[] = ['members', 'sessions', 'tasks', 'clothing', 'clothingItems', 'runs', 'lineupTemplates'];

/**
 * Sammlungen, die jeder Server mit allgemeinem Abgleich kennt. Neuere Server melden ihre Liste selbst
 * (`collections`); bis dahin bleiben Änderungen an anderen Sammlungen vorgemerkt.
 */
export const BASE_COLLECTIONS: SyncCollection[] = ['members', 'sessions', 'tasks'];

/** Ereignisname: etwas hat sich geändert, ein Abgleich mit dem Server ist fällig. */
export const CHANGED_EVENT = 'jfhub:changed';

const notify = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED_EVENT));
};

/**
 * Merkt eine Änderung für den nächsten Abgleich vor (der aktuelle Stand des Datensatzes wird erst beim Senden gelesen).
 * `at` ist der Zeitpunkt für „letzte Änderung gewinnt“.
 */
export async function markChanged(collection: SyncCollection, id: string, deleted = false, at = Date.now()): Promise<void> {
  await db.outbox.put({ key: `${collection}:${id}`, collection, id, updatedAt: at, deleted: deleted ? 1 : 0 });
  notify();
}

/** Beim ersten Abgleich nach dem Update werden vorhandene Daten (Mitglieder, Dienste, Aufgaben …) einmalig mitgesendet. */
export async function seedOutboxOnce(): Promise<void> {
  if (!(await db.kv.get('records.seeded'))) {
    await markAllForSync();
    await db.kv.put({ key: 'records.seeded', value: true });
  }
  // Wettkampf-Läufe und Aufstellungsvorlagen kamen später dazu: bei bestehenden Geräten einmalig nachtragen.
  if (!(await db.kv.get(WETTKAMPF_SEEDED))) {
    await markAllForSync(['runs', 'lineupTemplates']);
    await db.kv.put({ key: WETTKAMPF_SEEDED, value: true });
  }
}

const WETTKAMPF_SEEDED = 'records.seeded.wettkampf';

/** Alle vorhandenen Datensätze zum Senden vormerken (nach Import oder Wiederherstellung). */
export async function markAllForSync(collections: SyncCollection[] = SYNC_COLLECTIONS): Promise<void> {
  const now = Date.now();
  const entries = [];
  for (const collection of collections) {
    for (const id of (await db.table(collection).toCollection().primaryKeys()) as string[]) {
      entries.push({ key: `${collection}:${id}`, collection, id, updatedAt: now, deleted: 0 as const });
    }
  }
  await db.outbox.bulkPut(entries);
  notify();
}
