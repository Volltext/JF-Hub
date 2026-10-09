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
      expect((await upgraded.kv.get('protokolle.rev'))?.value).toBe(12);
      expect(upgraded.tables.map((t) => t.name)).toEqual(expect.arrayContaining(['blobs', 'blobData']));
      await upgraded.blobs.put({ id: 'a-000001', kind: 'photo', mime: 'image/jpeg', name: '', size: 1, state: 'local', createdAt: 1, lastUsedAt: 1 });
      expect((await upgraded.blobs.where('state').equals('local').toArray()).map((b) => b.id)).toEqual(['a-000001']);
    } finally {
      await upgraded.delete();
    }
  });
});
