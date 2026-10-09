import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { newProtokoll } from '@/features/protokolle/model';
import { putLocalBlob, readBlob, saveDownloaded } from './blobs';
import { BACKUP_VERSION, exportBackup, importBackup, validateBackup } from './backup';

beforeEach(async () => {
  await Promise.all([db.members.clear(), db.sessions.clear(), db.tasks.clear(), db.clothing.clear(), db.clothingItems.clear(), db.protokolle.clear(), db.ydocs.clear(), db.folders.clear(), db.blobs.clear(), db.blobData.clear(), db.kv.clear()]);
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

  it('Roundtrip erhält Texte mit ungesendeten Änderungen; was der Server hat, steht nicht in der Sicherung', async () => {
    const state = (text: string) => {
      const d = new Y.Doc();
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, text);
      p.insert(0, [t]);
      d.getXmlFragment('body').insert(0, [p]);
      return Y.encodeStateAsUpdate(d);
    };
    await db.protokolle.bulkAdd([
      { ...newProtokoll(), id: 'ungesendet-1', dirty: 0, rev: 3, textRev: 3 },
      { ...newProtokoll(), id: 'sauber-0001', dirty: 0, rev: 4, textRev: 4 },
    ]);
    await db.ydocs.bulkPut([
      { id: 'ungesendet-1', update: state('nur hier'), serverSv: new Uint8Array([1, 2]), dirty: 1, seq: 5, created: true },
      { id: 'sauber-0001', update: state('beim Server'), dirty: 0, seq: 0 },
    ]);
    const saved = JSON.parse(JSON.stringify(await exportBackup())) as Awaited<ReturnType<typeof exportBackup>>;
    expect(saved.texts!.map((t) => t.id)).toEqual(['ungesendet-1']);

    await db.ydocs.clear();
    await importBackup(saved);
    const back = (await db.ydocs.get('ungesendet-1'))!;
    expect(back).toMatchObject({ dirty: 1, seq: 5, created: true });
    expect(Array.from(back.serverSv!)).toEqual([1, 2]);
    const d = new Y.Doc();
    Y.applyUpdate(d, back.update);
    expect(d.getXmlFragment('body').toString()).toContain('nur hier');
    expect(await db.ydocs.get('sauber-0001')).toBeUndefined(); // wird beim nächsten Abgleich wieder geholt
  });

  it('eine Sicherung aus der Zeit vor Version 8: ungesendete Änderungen an Protokollen bleiben als „(lokale Fassung)“ erhalten', async () => {
    const row = (id: string, over: object = {}) => ({ ...newProtokoll(), id, title: id, dirty: 0, rev: 5, ...over });
    await importBackup({
      app: 'jf-hub',
      version: 7,
      exportedAt: '',
      members: [],
      sessions: [],
      tasks: [],
      protokolle: [row('sauber-0001'), row('geaendert-1', { dirty: 1, title: 'Geändert' }), row('neu-nie-001', { dirty: 1, rev: 0 })],
      settings: {},
    });
    const all = await db.protokolle.toArray();
    expect(all).toHaveLength(4);
    expect(await db.protokolle.get('geaendert-1')).toMatchObject({ dirty: 0 });
    expect(await db.protokolle.get('neu-nie-001')).toMatchObject({ dirty: 1, rev: 0 });
    expect(all.find((p) => p.title === 'Geändert (lokale Fassung)')).toMatchObject({ rev: 0, dirty: 1 });
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
