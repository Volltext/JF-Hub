import { db } from '@/core/db/db';
import { newId } from '@/core/domain/id';
import { META_FIELDS, stampMeta, type Ordner } from './model';
import { scheduleSync } from './sync';

/** Oberste Ebene. */
export const ROOT = '';

/**
 * Ordner, in dem ein Protokoll angezeigt wird. Kennt dieses Gerät den eingetragenen Ordner nicht (zum Beispiel, weil ein anderer
 * Betreuer ihn gelöscht hat, während das Protokoll privat war), liegt es auf der obersten Ebene, statt unauffindbar zu sein.
 */
export const shownFolder = (all: Ordner[], folderId: string | undefined): string => (folderId && all.some((f) => f.id === folderId) ? folderId : ROOT);

const byName = (a: Ordner, b: Ordner) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });

export const childFolders = (all: Ordner[], parentId: string): Ordner[] => all.filter((f) => f.parentId === parentId).sort(byName);

/** Pfad von der obersten Ebene bis zum Ordner (leer bei ROOT); bricht bei defekten Zyklen ab. */
export function folderPath(all: Ordner[], id: string): Ordner[] {
  const byId = new Map(all.map((f) => [f.id, f]));
  const path: Ordner[] = [];
  for (let f = byId.get(id); f && path.length < 50; f = byId.get(f.parentId)) path.unshift(f);
  return path;
}

export const folderPathLabel = (all: Ordner[], id: string): string => folderPath(all, id).map((f) => f.name).join(' / ');

/** Der Ordner selbst und alle darunterliegenden Ordner. */
export function folderAndDescendants(all: Ordner[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of all) if (!out.has(f.id) && out.has(f.parentId)) (out.add(f.id), (grew = true));
  }
  return out;
}

/** Flache Liste für Auswahldialoge: Ordner mit Einrücktiefe, alphabetisch je Ebene. */
export function folderTree(all: Ordner[], skip?: Set<string>): { folder: Ordner; depth: number }[] {
  const out: { folder: Ordner; depth: number }[] = [];
  const walk = (parent: string, depth: number) => {
    for (const f of childFolders(all, parent)) {
      if (skip?.has(f.id)) continue;
      out.push({ folder: f, depth });
      if (depth < 50) walk(f.id, depth + 1);
    }
  };
  walk(ROOT, 0);
  return out;
}

export const liveFolders = () => db.folders.filter((f) => f.deleted === 0).toArray();

export const folderRepo = {
  async create(name: string, parentId: string): Promise<Ordner> {
    const f: Ordner = { id: newId(), name: name.trim() || 'Neuer Ordner', parentId, rev: 0, updatedAt: Date.now(), dirty: 1, deleted: 0 };
    await db.folders.add(f);
    scheduleSync(800);
    return f;
  },

  async rename(id: string, name: string): Promise<void> {
    await db.folders.update(id, { name: name.trim() || 'Ordner', updatedAt: Date.now(), dirty: 1 });
    scheduleSync(800);
  },

  async move(id: string, parentId: string): Promise<void> {
    const all = await liveFolders();
    if (folderAndDescendants(all, id).has(parentId)) return; // nie in sich selbst verschieben
    await db.folders.update(id, { parentId, updatedAt: Date.now(), dirty: 1 });
    scheduleSync(800);
  },

  /** Löscht den Ordner; Unterordner und Protokolle rücken eine Ebene nach oben, es geht nichts verloren. */
  async remove(id: string): Promise<void> {
    await db.transaction('rw', db.folders, db.protokolle, async () => {
      const f = await db.folders.get(id);
      if (!f) return;
      const now = Date.now();
      await db.folders.where('parentId').equals(id).modify({ parentId: f.parentId, updatedAt: now, dirty: 1 });
      // Auch hier bekommt das Feld eine eigene Änderungszeit: Der Server führt die Kopfdaten Feld für Feld zusammen.
      await db.protokolle.filter((p) => p.folderId === id && p.deleted === 0).modify((p) => {
        p.metaAt = stampMeta({ ...Object.fromEntries(META_FIELDS.map((k) => [k, p.updatedAt])), ...p.metaAt }, ['folderId'], now);
        p.folderId = f.parentId;
        p.updatedAt = now;
        p.dirty = 1;
      });
      if (f.rev === 0) await db.folders.delete(id);
      else await db.folders.update(id, { deleted: 1, dirty: 1, updatedAt: now });
    });
    scheduleSync(800);
  },
};
