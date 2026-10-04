import { db } from './db';

export const BACKUP_VERSION = 6;

/** kv-Einträge, die zur Sicherung gehören (alles andere sind Zwischenspeicher wie die Server-Auswahllisten). */
const isBackedUpKv = (key: string) => key === 'lineup.current' || key === 'lsp.state' || key.startsWith('draft.');

export interface Backup {
  app: 'jf-hub';
  version: number;
  exportedAt: string;
  members: unknown[];
  sessions: unknown[];
  tasks: unknown[];
  /** Ab Version 3. */
  runs?: unknown[];
  lineupTemplates?: unknown[];
  /** Ab Version 4 (lokaler Cache; die Wahrheit liegt auf dem Server). */
  protokolle?: unknown[];
  folders?: unknown[];
  /** Ab Version 6. */
  clothing?: unknown[];
  clothingItems?: unknown[];
  kv?: { key: string; value: unknown }[];
  settings: unknown;
}

export async function exportBackup(): Promise<Backup> {
  return {
    app: 'jf-hub',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    members: await db.members.toArray(),
    sessions: await db.sessions.toArray(),
    tasks: await db.tasks.toArray(),
    runs: await db.runs.toArray(),
    lineupTemplates: await db.lineupTemplates.toArray(),
    protokolle: await db.protokolle.toArray(),
    folders: await db.folders.toArray(),
    clothing: await db.clothing.toArray(),
    clothingItems: await db.clothingItems.toArray(),
    kv: (await db.kv.toArray()).filter((r) => isBackedUpKv(r.key)),
    settings: (await db.kv.get('settings'))?.value ?? {},
  };
}

export function validateBackup(raw: unknown): Backup {
  const b = raw as Partial<Backup>;
  if (!b || b.app !== 'jf-hub') throw new Error('Keine JF-Hub-Sicherung.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION)
    throw new Error('Sicherung stammt aus einer neueren App-Version.');
  for (const k of ['members', 'sessions', 'tasks'] as const)
    if (!Array.isArray(b[k])) throw new Error(`Sicherung unvollständig: ${k}`);
  for (const k of ['runs', 'lineupTemplates', 'protokolle', 'folders', 'clothing', 'clothingItems', 'kv'] as const)
    if (b[k] !== undefined && !Array.isArray(b[k])) throw new Error(`Sicherung unvollständig: ${k}`);
  return b as Backup;
}

/** Ersetzt alle Daten atomar durch den Inhalt der Sicherung. */
export async function importBackup(raw: unknown): Promise<void> {
  const b = validateBackup(raw);
  // Konto, Benutzerverzeichnis und Push-Anmeldung gehören zu diesem Gerät, nicht zur Sicherung.
  const keep = (await db.kv.bulkGet(['account', 'directory', 'push.endpoint'])).filter((r): r is NonNullable<typeof r> => !!r);
  const tables = [db.members, db.sessions, db.tasks, db.runs, db.lineupTemplates, db.protokolle, db.folders, db.clothing, db.clothingItems, db.kv];
  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
    await db.members.bulkAdd(b.members as never[]);
    await db.sessions.bulkAdd(b.sessions as never[]);
    await db.tasks.bulkAdd(b.tasks as never[]);
    await db.runs.bulkAdd((b.runs ?? []) as never[]);
    await db.lineupTemplates.bulkAdd((b.lineupTemplates ?? []) as never[]);
    await db.protokolle.bulkAdd((b.protokolle ?? []) as never[]);
    await db.folders.bulkAdd((b.folders ?? []) as never[]);
    await db.clothing.bulkAdd((b.clothing ?? []) as never[]);
    await db.clothingItems.bulkAdd((b.clothingItems ?? []) as never[]);
    await db.kv.bulkAdd((b.kv ?? []) as never[]);
    await db.kv.bulkPut(keep);
    await db.kv.put({ key: 'settings', value: b.settings });
  });
}
