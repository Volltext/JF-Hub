import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { db, HubDb } from './db';

/** Alle Spalten, nach denen die Oberfläche mit `orderBy(...)` sortiert, müssen im Schema indiziert sein. */
describe('Datenbank-Schema', () => {
  const used: [table: keyof typeof db & string, index: string][] = [
    ['members', 'name'],
    ['sessions', 'date'],
    ['runs', 'createdAt'],
  ];

  it.each(used)('%s ist nach %s sortierbar', (table, index) => {
    const schema = (db as unknown as Record<string, { schema: { idxByName: Record<string, unknown> } }>)[table]!.schema;
    expect(schema.idxByName[index]).toBeDefined();
  });
});

describe('Datenbank-Update', () => {
  it('ein Gerät mit der Datenbank aus Version 2.1 bekommt die Anhang-Tabellen und behält seine Daten', async () => {
    const name = 'upgrade-von-version-8';
    // So legte die App bis 2.1.x die Datenbank an (Dexie-Version 8).
    const old = new Dexie(name);
    old.version(8).stores({
      members: 'id, name, kind, active',
      sessions: 'id, date',
      tasks: 'id, dueDate, completed, sessionId',
      kv: 'key',
      runs: 'id, mode, createdAt',
      lineupTemplates: 'id',
      protokolle: 'id, datum, updatedAt, dirty',
      folders: 'id, parentId, dirty',
      outbox: 'key',
      clothing: 'id',
      clothingItems: 'id, order',
    });
    await old.open();
    await old.table('protokolle').add({ id: 'p1', title: 'Alt', datum: '2026-10-01', updatedAt: 1, dirty: 1 });
    await old.table('kv').add({ key: 'protokolle.rev', value: 12 });
    old.close();

    const upgraded = new HubDb(name);
    try {
      await upgraded.open();
      expect(await upgraded.protokolle.get('p1')).toMatchObject({ title: 'Alt', dirty: 1 });
      expect(upgraded.tables.map((t) => t.name)).toEqual(expect.arrayContaining(['blobs', 'blobData', 'ydocs']));
      await upgraded.blobs.put({ id: 'a-000001', kind: 'photo', mime: 'image/jpeg', name: '', size: 1, state: 'local', createdAt: 1, lastUsedAt: 1 });
      expect((await upgraded.blobs.where('state').equals('local').toArray()).map((b) => b.id)).toEqual(['a-000001']);
    } finally {
      await upgraded.delete();
    }
  });
});

describe('Datenbank-Update auf 3.0.0 (Text als Yjs-Dokument)', () => {
  /** So legte die App bis 2.3.x die Datenbank an (Dexie-Version 9). */
  async function oldDevice(name: string, rows: object[], kv: object[] = []) {
    const old = new Dexie(name);
    old.version(9).stores({
      members: 'id, name, kind, active',
      sessions: 'id, date',
      tasks: 'id, dueDate, completed, sessionId',
      kv: 'key',
      runs: 'id, mode, createdAt',
      lineupTemplates: 'id',
      protokolle: 'id, datum, updatedAt, dirty',
      folders: 'id, parentId, dirty',
      outbox: 'key',
      clothing: 'id',
      clothingItems: 'id, order',
      blobs: 'id, state, lastUsedAt',
      blobData: 'id',
    });
    await old.open();
    await old.table('protokolle').bulkAdd(rows);
    await old.table('kv').bulkAdd(kv);
    old.close();
  }
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    title: id,
    datum: '2026-10-01',
    beginn: '',
    ende: '',
    ort: '',
    leitung: '',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Text von ${id}` }] }] },
    shared: true,
    ownerId: 'u-anna',
    rev: 5,
    updatedAt: 100,
    dirty: 0,
    deleted: 0,
    ...over,
  });

  it('ungesendete Änderungen aus 2.3.x bleiben als eigene Kopie erhalten; Saubere, Neue und zum Löschen Vorgemerkte bleiben unberührt', async () => {
    const name = 'upgrade-von-version-9';
    await oldDevice(
      name,
      [row('sauber'), row('geaendert', { dirty: 1, title: 'Geändert' }), row('neu-nie', { dirty: 1, rev: 0 }), row('loeschen', { dirty: 1, deleted: 1 })],
      [{ key: 'protokolle.rev', value: 40 }, { key: 'protokolle.epoch', value: 'abc' }],
    );
    const upgraded = new HubDb(name);
    try {
      await upgraded.open();
      const all = await upgraded.protokolle.toArray();
      const copy = all.find((p) => p.title === 'Geändert (lokale Fassung)')!;
      expect(copy).toMatchObject({ rev: 0, dirty: 1, shared: true, deleted: 0 });
      expect(copy.id).not.toBe('geaendert');
      expect(copy.ownerId).toBeUndefined();
      expect(JSON.stringify(copy.content)).toContain('Text von geaendert');
      expect(Object.keys(copy.metaAt!).sort()).toEqual(['beginn', 'datum', 'ende', 'folderId', 'leitung', 'ort', 'shared', 'title']);
      // das Original gleicht sich mit dem Server ab
      expect(await upgraded.protokolle.get('geaendert')).toMatchObject({ dirty: 0 });
      expect(await upgraded.protokolle.get('sauber')).toMatchObject({ dirty: 0, title: 'sauber' });
      expect(await upgraded.protokolle.get('neu-nie')).toMatchObject({ dirty: 1, rev: 0 });
      expect(await upgraded.protokolle.get('loeschen')).toMatchObject({ dirty: 1, deleted: 1 });
      expect(all).toHaveLength(5);
      // alles neu vom Server holen, die Kennung der Datenbank bleibt
      expect(await upgraded.kv.get('protokolle.rev')).toBeUndefined();
      expect((await upgraded.kv.get('protokolle.epoch'))?.value).toBe('abc');
      expect(await upgraded.ydocs.count()).toBe(0);
    } finally {
      await upgraded.delete();
    }
  });

  it('ein Gerät ohne ungesendete Änderungen bekommt nur die neue Tabelle', async () => {
    const name = 'upgrade-sauber';
    await oldDevice(name, [row('a-000001'), row('b-000001')]);
    const upgraded = new HubDb(name);
    try {
      await upgraded.open();
      expect(await upgraded.protokolle.count()).toBe(2);
      expect(await upgraded.ydocs.count()).toBe(0);
    } finally {
      await upgraded.delete();
    }
  });
});
