import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/core/db/db';
import { newProtokoll, type Ordner } from './model';

vi.mock('./sync', () => ({ scheduleSync: vi.fn(), syncNow: vi.fn(async () => null) }));
import { ROOT, childFolders, folderAndDescendants, folderPath, folderPathLabel, folderRepo, folderTree, liveFolders, shownFolder } from './folders';

const folder = (id: string, name: string, parentId = '', over: Partial<Ordner> = {}): Ordner => ({ id, name, parentId, rev: 1, updatedAt: 1, dirty: 0, deleted: 0, ...over });

beforeEach(async () => {
  await Promise.all([db.protokolle.clear(), db.folders.clear()]);
});

describe('Ordner-Baum', () => {
  const all = [folder('a', 'Dienst 10'), folder('b', 'Dienst 2'), folder('c', 'Unter', 'a'), folder('d', 'Ganz unten', 'c')];

  it('sortiert Ordner je Ebene nach Namen, Zahlen als Zahlen', () => {
    expect(childFolders(all, ROOT).map((f) => f.name)).toEqual(['Dienst 2', 'Dienst 10']);
    expect(childFolders(all, 'a').map((f) => f.id)).toEqual(['c']);
  });

  it('liefert Pfad und Beschriftung von oben nach unten', () => {
    expect(folderPath(all, 'd').map((f) => f.id)).toEqual(['a', 'c', 'd']);
    expect(folderPathLabel(all, 'd')).toBe('Dienst 10 / Unter / Ganz unten');
    expect(folderPath(all, ROOT)).toEqual([]);
    expect(folderPath(all, 'gibt-es-nicht')).toEqual([]);
  });

  it('bricht bei einem defekten Zyklus ab, statt endlos zu laufen', () => {
    const loop = [folder('x', 'X', 'y'), folder('y', 'Y', 'x')];
    expect(folderPath(loop, 'x').length).toBeLessThanOrEqual(50);
  });

  it('nennt einen Ordner mit allen darunterliegenden', () => {
    expect([...folderAndDescendants(all, 'a')].sort()).toEqual(['a', 'c', 'd']);
    expect([...folderAndDescendants(all, 'b')]).toEqual(['b']);
  });

  it('macht aus dem Baum eine Liste mit Einrückung und lässt Ausgeschlossenes samt Unterordnern weg', () => {
    expect(folderTree(all).map((x) => [x.folder.id, x.depth])).toEqual([['b', 0], ['a', 0], ['c', 1], ['d', 2]]);
    expect(folderTree(all, folderAndDescendants(all, 'a')).map((x) => x.folder.id)).toEqual(['b']);
  });

  it('zeigt Protokolle in unbekannten Ordnern auf der obersten Ebene (statt unauffindbar)', () => {
    expect(shownFolder(all, 'c')).toBe('c');
    expect(shownFolder(all, 'von-einem-anderen-geloescht')).toBe(ROOT);
    expect(shownFolder(all, '')).toBe(ROOT);
    expect(shownFolder(all, undefined)).toBe(ROOT);
  });
});

describe('folderRepo', () => {
  it('legt Ordner an (Name bereinigt, ungesendet) und benennt um', async () => {
    const f = await folderRepo.create('  Neu  ', '');
    expect(await db.folders.get(f.id)).toMatchObject({ name: 'Neu', dirty: 1, rev: 0 });
    expect((await folderRepo.create('   ', '')).name).toBe('Neuer Ordner');
    await folderRepo.rename(f.id, '   ');
    expect((await db.folders.get(f.id))?.name).toBe('Ordner');
  });

  it('verschiebt Ordner, aber nie in sich selbst oder einen Unterordner', async () => {
    await db.folders.bulkAdd([folder('a', 'A'), folder('b', 'B', 'a'), folder('c', 'C')]);
    await folderRepo.move('a', 'b'); // in den eigenen Unterordner: abgelehnt
    expect((await db.folders.get('a'))?.parentId).toBe('');
    await folderRepo.move('c', 'b');
    expect(await db.folders.get('c')).toMatchObject({ parentId: 'b', dirty: 1 });
  });

  it('beim Löschen rücken Unterordner und Protokolle eine Ebene nach oben, nichts geht verloren', async () => {
    const p = { ...newProtokoll('mitte'), dirty: 0 as const, rev: 2 };
    await db.folders.bulkAdd([folder('oben', 'Oben'), folder('mitte', 'Mitte', 'oben'), folder('unten', 'Unten', 'mitte')]);
    await db.protokolle.add(p);
    await folderRepo.remove('mitte');
    expect(await db.folders.get('unten')).toMatchObject({ parentId: 'oben', dirty: 1 });
    expect(await db.protokolle.get(p.id)).toMatchObject({ folderId: 'oben', dirty: 1 });
    // der Server führt die Kopfdaten Feld für Feld zusammen: Auch der neue Ordner braucht seine Änderungszeit, sonst gewinnt der alte Wert
    const moved = (await db.protokolle.get(p.id))!;
    expect(moved.metaAt!.folderId).toBeGreaterThanOrEqual(moved.updatedAt);
    expect(moved.metaAt!.title).toBeLessThan(moved.metaAt!.folderId!);
    expect(await db.folders.get('mitte')).toMatchObject({ deleted: 1, dirty: 1 }); // dem Server wird die Löschung gemeldet
    expect((await liveFolders()).map((f) => f.id).sort()).toEqual(['oben', 'unten']);
  });

  it('nie gesendete Ordner verschwinden sofort', async () => {
    const f = await folderRepo.create('Flüchtig', '');
    await folderRepo.remove(f.id);
    expect(await db.folders.get(f.id)).toBeUndefined();
  });
});
