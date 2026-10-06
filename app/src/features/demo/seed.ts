import type { JSONContent } from '@tiptap/core';
import { DEMO_NAMES, demoData } from '@demo-data';
import { db } from '@/core/db/db';
import { wipeLocalData } from '@/core/db/wipe';
import { saveAccount, saveDirectory, type Account } from '@/core/account/account';
import type { Ordner, Protokoll } from '@/features/protokolle/model';

/** In der Browser-Demo ist man Jana, die Jugendwartin. Tobias' private Einträge gibt es hier deshalb nicht. */
export const DEMO_ACCOUNT: Account = { id: 'demo-jana', username: 'jugendwart', displayName: DEMO_NAMES.jana, role: 'admin' };
const TOBIAS = 'demo-tobias';
const SEEDED_KEY = 'demo.seededAt';

export async function isDemoSeeded(): Promise<boolean> {
  return !!(await db.kv.get(SEEDED_KEY));
}

/**
 * Legt die Beispieldaten im Browser an (dieselben wie auf dem Demo-Server) und ersetzt dabei alles, was vorher da war.
 * Die Daten sind relativ zu `now` datiert, ein Zurücksetzen bringt sie also auch auf den aktuellen Tag.
 */
export async function seedDemo(now = new Date()): Promise<void> {
  const data = demoData(now, { jana: DEMO_ACCOUNT.id, tobias: TOBIAS });
  const visible = (e: { ownerId: string; shared: boolean }) => e.shared || e.ownerId === DEMO_ACCOUNT.id;
  await wipeLocalData();
  await db.transaction('rw', [db.protokolle, db.folders, db.members, db.sessions, db.tasks, db.clothing, db.clothingItems, db.runs, db.lineupTemplates, db.kv], async () => {
    for (const r of data.records.filter(visible)) await db.table(r.collection).put(r.data);
    await db.folders.bulkPut(data.folders.map((f): Ordner => ({ ...f, rev: 1, dirty: 0, deleted: 0 })));
    await db.protokolle.bulkPut(data.protocols.filter(visible).map((p): Protokoll => ({ ...p, content: p.content as JSONContent, rev: 1, dirty: 0, deleted: 0 })));
    // Die Standard-Kleidungsstücke sind schon dabei.
    await db.kv.put({ key: 'kleidung.seeded', value: true });
    await db.kv.put({ key: SEEDED_KEY, value: now.toISOString() });
  });
  await saveAccount(DEMO_ACCOUNT);
  await saveDirectory([
    { id: DEMO_ACCOUNT.id, name: DEMO_NAMES.jana },
    { id: TOBIAS, name: DEMO_NAMES.tobias },
  ]);
}
