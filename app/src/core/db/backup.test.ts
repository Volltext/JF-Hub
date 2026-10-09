import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { newProtokoll } from '@/features/protokolle/model';
import { putLocalBlob, readBlob, saveDownloaded } from './blobs';
import { BACKUP_VERSION, exportBackup, importBackup, validateBackup } from './backup';

beforeEach(async () => {
  await Promise.all([db.members.clear(), db.sessions.clear(), db.tasks.clear(), db.clothing.clear(), db.clothingItems.clear(), db.protokolle.clear(), db.folders.clear(), db.blobs.clear(), db.blobData.clear(), db.kv.clear()]);
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

  it('Roundtrip erhält Anhänge, die nur auf diesem Gerät liegen; Kopien des Servers gehören nicht hinein', async () => {
    const photo = Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]);
    await putLocalBlob({ id: 'mein-00001', kind: 'photo', mime: 'image/jpeg', name: '', data: photo });
    await putLocalBlob({ id: 'mein-00002', kind: 'file', mime: 'application/pdf', name: 'Plan.pdf', data: Uint8Array.from([37, 80, 68, 70]) });
    await saveDownloaded({ id: 'kopie-0001', kind: 'photo', mime: 'image/jpeg', name: '' }, Uint8Array.from([0xff, 0xd8, 0xff, 9]));

    const saved = JSON.parse(JSON.stringify(await exportBackup())) as Awaited<ReturnType<typeof exportBackup>>; // wie aus einer Datei
    expect(saved.version).toBe(BACKUP_VERSION);
    expect(saved.blobs!.map((b) => (b as { id: string }).id).sort()).toEqual(['mein-00001', 'mein-00002']);

    await db.blobs.clear();
    await db.blobData.clear();
    await importBackup(saved);
    const back = await readBlob('mein-00001');
    expect(Array.from(back!.data)).toEqual(Array.from(photo));
    expect(back!.meta).toMatchObject({ kind: 'photo', mime: 'image/jpeg', state: 'local', size: 6 });
    expect((await readBlob('mein-00002'))!.meta).toMatchObject({ kind: 'file', name: 'Plan.pdf' });
    expect(await db.blobs.get('kopie-0001')).toBeUndefined();
  });

  it('nimmt Sicherungen aus der Zeit vor den Anhängen an und lässt vorhandene Anhänge dabei nicht stehen', async () => {
    await putLocalBlob({ id: 'mein-00001', kind: 'photo', mime: 'image/jpeg', name: '', data: Uint8Array.from([0xff, 0xd8, 0xff, 1]) });
    await importBackup({ app: 'jf-hub', version: 6, exportedAt: '', members: [], sessions: [], tasks: [], settings: {} });
    expect(await db.blobs.count()).toBe(0);
    expect(await db.blobData.count()).toBe(0);
  });

  it('lehnt fremde und zu neue Dateien ab', () => {
    expect(() => validateBackup({ app: 'x' })).toThrow();
    expect(() =>
      validateBackup({ app: 'jf-hub', version: 99, members: [], sessions: [], tasks: [] }),
    ).toThrow(/neuer/);
  });
});
