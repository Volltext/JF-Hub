import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { newProtokoll } from '@/features/protokolle/model';
import { exportBackup, importBackup, validateBackup } from './backup';

beforeEach(async () => {
  await Promise.all([db.members.clear(), db.sessions.clear(), db.tasks.clear(), db.clothing.clear(), db.clothingItems.clear(), db.protokolle.clear(), db.folders.clear(), db.kv.clear()]);
});

describe('Backup', () => {
  it('Roundtrip erhält Daten', async () => {
    await db.members.add({ id: 'm1', name: 'Anna', kind: 'jugendlich', active: true });
    await db.clothing.put({ id: 'm1', items: { 'kombi-jacke': { current: '164', request: null } } });
    await db.clothingItems.put({ id: 'kombi-jacke', name: 'Kombi-Jacke', sizes: ['164', '170'], order: 0 });
    const b = await exportBackup();
    await db.members.clear();
    await db.clothing.clear();
    await db.clothingItems.clear();
    await importBackup(b);
    expect(await db.members.count()).toBe(1);
    expect((await db.clothing.get('m1'))?.items['kombi-jacke']?.current).toBe('164');
    expect(await db.clothingItems.count()).toBe(1);
  });

  it('Roundtrip erhält Protokolle (Text, Ordner, Sichtbarkeit) und Ordner', async () => {
    const p = { ...newProtokoll('ordner-1', true), title: 'Sitzung', ort: 'Gerätehaus', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hallo' }] }] }, rev: 4, dirty: 0 as const };
    await db.protokolle.add(p);
    await db.folders.add({ id: 'ordner-1', name: 'Dienst', parentId: '', rev: 2, updatedAt: 1, dirty: 0, deleted: 0 });
    const b = await exportBackup();
    await db.protokolle.clear();
    await db.folders.clear();
    await importBackup(b);
    expect(await db.protokolle.get(p.id)).toMatchObject({ title: 'Sitzung', ort: 'Gerätehaus', folderId: 'ordner-1', shared: true, content: p.content });
    expect(await db.folders.get('ordner-1')).toMatchObject({ name: 'Dienst' });
  });

  it('lehnt fremde und zu neue Dateien ab', () => {
    expect(() => validateBackup({ app: 'x' })).toThrow();
    expect(() =>
      validateBackup({ app: 'jf-hub', version: 99, members: [], sessions: [], tasks: [] }),
    ).toThrow(/neuer/);
  });
});
