import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { exportBackup, importBackup, validateBackup } from './backup';

beforeEach(async () => {
  await Promise.all([db.members.clear(), db.sessions.clear(), db.tasks.clear(), db.clothing.clear(), db.clothingItems.clear(), db.kv.clear()]);
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

  it('lehnt fremde und zu neue Dateien ab', () => {
    expect(() => validateBackup({ app: 'x' })).toThrow();
    expect(() =>
      validateBackup({ app: 'jf-hub', version: 99, members: [], sessions: [], tasks: [] }),
    ).toThrow(/neuer/);
  });
});
