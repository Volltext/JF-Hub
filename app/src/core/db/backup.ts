import { base64ToBytes, bytesToBase64 } from '@/core/domain/base64';
import { db } from './db';

export const BACKUP_VERSION = 7;

/** kv-Einträge, die zur Sicherung gehören (alles andere sind Zwischenspeicher wie die Server-Auswahllisten). */
const isBackedUpKv = (key: string) => key === 'lineup.current' || key === 'lsp.state' || key.startsWith('draft.');

/** Ein Anhang, der nur auf diesem Gerät liegt, samt Bytes (Base64). Was der Server hat, steht nicht in der Sicherung. */
export interface BackupBlob {
  id: string;
  kind: 'photo' | 'file';
  mime: string;
  name: string;
  size: number;
  createdAt: number;
  data: string;
}

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
  /** Ab Version 7: Fotos und Dateien, die noch nicht auf dem Server sind. */
  blobs?: BackupBlob[];
  kv?: { key: string; value: unknown }[];
  settings: unknown;
}

async function localBlobs(): Promise<BackupBlob[]> {
  const out: BackupBlob[] = [];
  for (const meta of await db.blobs.where('state').equals('local').toArray()) {
    const row = await db.blobData.get(meta.id);
    if (row) out.push({ id: meta.id, kind: meta.kind, mime: meta.mime, name: meta.name, size: meta.size, createdAt: meta.createdAt, data: bytesToBase64(row.data) });
  }
  return out;
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
    blobs: await localBlobs(),
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
  for (const k of ['runs', 'lineupTemplates', 'protokolle', 'folders', 'clothing', 'clothingItems', 'blobs', 'kv'] as const)
    if (b[k] !== undefined && !Array.isArray(b[k])) throw new Error(`Sicherung unvollständig: ${k}`);
  return b as Backup;
}

/** Ersetzt alle Daten atomar durch den Inhalt der Sicherung. */
export async function importBackup(raw: unknown): Promise<void> {
  const b = validateBackup(raw);
  // Konto, Benutzerverzeichnis und Push-Anmeldung gehören zu diesem Gerät, nicht zur Sicherung.
  const keep = (await db.kv.bulkGet(['account', 'directory', 'push.endpoint'])).filter((r): r is NonNullable<typeof r> => !!r);
  // Beschädigte Anhänge fallen auf, bevor irgendetwas ersetzt wird.
  const now = Date.now();
  const blobs = (b.blobs ?? []).map((x) => ({
    meta: { id: x.id, kind: x.kind, mime: x.mime, name: x.name, size: x.size, state: 'local' as const, createdAt: x.createdAt, lastUsedAt: now },
    data: { id: x.id, data: base64ToBytes(x.data) },
  }));
  const tables = [db.members, db.sessions, db.tasks, db.runs, db.lineupTemplates, db.protokolle, db.folders, db.clothing, db.clothingItems, db.blobs, db.blobData, db.kv];
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
    await db.blobs.bulkAdd(blobs.map((x) => x.meta));
    await db.blobData.bulkAdd(blobs.map((x) => x.data));
    await db.kv.bulkAdd((b.kv ?? []) as never[]);
    await db.kv.bulkPut(keep);
    await db.kv.put({ key: 'settings', value: b.settings });
  });
}
