import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db/db';
import { memberRepo } from '@/core/db/repos';
import { DEFAULT_ITEMS } from './model';
import { clothingItemRepo, clothingRepo, ensureDefaultItems } from './repo';

beforeEach(async () => {
  await Promise.all([db.members.clear(), db.clothing.clear(), db.clothingItems.clear(), db.outbox.clear(), db.kv.clear()]);
});

describe('Kleidung speichern', () => {
  it('merkt eine größere Größe vor, gibt sie aus und übernimmt sie als aktuelle', async () => {
    await clothingRepo.setCurrent('m1', 'kombi-jacke', '52');
    await clothingRepo.setRequest('m1', 'kombi-jacke', '54');
    expect((await db.clothing.get('m1'))?.items['kombi-jacke']).toMatchObject({ current: '52', request: { size: '54', passedOn: null } });
    expect(await db.outbox.get('clothing:m1')).toBeDefined();

    await clothingRepo.markPassedOn([{ memberId: 'm1', itemId: 'kombi-jacke' }], '2026-10-05');
    expect((await db.clothing.get('m1'))?.items['kombi-jacke']?.request?.passedOn).toBe('2026-10-05');

    await clothingRepo.received('m1', 'kombi-jacke');
    expect((await db.clothing.get('m1'))?.items['kombi-jacke']).toEqual({ current: '54', request: null });
  });

  it('eine geänderte Größe gilt wieder als neu, gleiche Größe ändert nichts', async () => {
    await clothingRepo.setRequest('m1', 'kombi-hose', '50');
    await clothingRepo.markPassedOn([{ memberId: 'm1', itemId: 'kombi-hose' }], '2026-10-05');
    await clothingRepo.setRequest('m1', 'kombi-hose', '50');
    expect((await db.clothing.get('m1'))?.items['kombi-hose']?.request?.passedOn).toBe('2026-10-05');
    await clothingRepo.setRequest('m1', 'kombi-hose', '52');
    expect((await db.clothing.get('m1'))?.items['kombi-hose']?.request).toMatchObject({ size: '52', passedOn: null });
  });

  it('entfernt leere Zellen', async () => {
    await clothingRepo.setCurrent('m1', 'handschuhe', '8');
    await clothingRepo.setCurrent('m1', 'handschuhe', '');
    expect((await db.clothing.get('m1'))?.items).toEqual({});
  });

  it('löscht die Größen mit dem Mitglied', async () => {
    const m = await memberRepo.add('Linus', 'jugendlich');
    await clothingRepo.setCurrent(m.id, 'kombi-jacke', '176');
    await memberRepo.remove(m.id);
    expect(await db.clothing.get(m.id)).toBeUndefined();
    expect(await db.outbox.get(`clothing:${m.id}`)).toMatchObject({ deleted: 1 });
  });
});

describe('Kleidungsstücke', () => {
  it('legt die Standardstücke einmalig mit altem Zeitstempel an', async () => {
    await ensureDefaultItems();
    expect((await db.clothingItems.orderBy('order').toArray()).map((i) => i.name)).toEqual(DEFAULT_ITEMS.map((i) => i.name));
    expect((await db.outbox.get('clothingItems:kombi-jacke'))?.updatedAt).toBe(1);
    await clothingItemRepo.remove('handschuhe');
    await ensureDefaultItems();
    expect(await db.clothingItems.get('handschuhe')).toBeUndefined();
  });

  it('fügt hinzu und sortiert um', async () => {
    await ensureDefaultItems();
    const shirt = await clothingItemRepo.add(' T-Shirt ', ['S', 'M']);
    expect(shirt).toMatchObject({ name: 'T-Shirt', order: 4 });
    await clothingItemRepo.move(shirt.id, -1);
    expect((await db.clothingItems.orderBy('order').toArray()).map((i) => i.id).slice(-2)).toEqual([shirt.id, 'handschuhe']);
    await expect(clothingItemRepo.add('  ', [])).rejects.toThrow('Name fehlt');
  });
});
