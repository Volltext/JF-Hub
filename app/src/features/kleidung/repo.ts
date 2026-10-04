import { db } from '@/core/db/db';
import { markChanged } from '@/core/db/outbox';
import { newId, todayIso } from '@/core/domain/id';
import { DEFAULT_ITEMS, EMPTY_SLOT, type ClothingItem, type ClothingRecord, type ClothingSlot } from './model';

const SEEDED_KEY = 'kleidung.seeded';

/**
 * Legt einmalig die Standard-Kleidungsstücke an. Sie werden mit sehr altem Zeitstempel vorgemerkt,
 * damit Änderungen, die schon von einem anderen Gerät auf dem Server liegen, immer Vorrang haben.
 */
export async function ensureDefaultItems(): Promise<void> {
  if (await db.kv.get(SEEDED_KEY)) return;
  await db.transaction('rw', [db.clothingItems, db.outbox, db.kv], async () => {
    if ((await db.clothingItems.count()) === 0) {
      await db.clothingItems.bulkPut(DEFAULT_ITEMS);
      for (const item of DEFAULT_ITEMS) await markChanged('clothingItems', item.id, false, 1);
    }
    await db.kv.put({ key: SEEDED_KEY, value: true });
  });
}

/** Ändert eine Zelle der Kleidertabelle; leere Zellen werden nicht gespeichert. */
async function updateSlot(memberId: string, itemId: string, fn: (slot: ClothingSlot) => ClothingSlot): Promise<void> {
  const rec: ClothingRecord = (await db.clothing.get(memberId)) ?? { id: memberId, items: {} };
  const next = fn(rec.items[itemId] ?? EMPTY_SLOT);
  const items = { ...rec.items };
  if (!next.current && !next.request) delete items[itemId];
  else items[itemId] = next;
  await db.clothing.put({ id: memberId, items });
  await markChanged('clothing', memberId);
}

export const clothingRepo = {
  setCurrent: (memberId: string, itemId: string, size: string) =>
    updateSlot(memberId, itemId, (s) => ({ ...s, current: size.trim() })),

  /** Neue Größe zum Beschaffen vormerken (null = Wunsch verwerfen). Eine geänderte Größe gilt wieder als neu. */
  setRequest: (memberId: string, itemId: string, size: string | null) =>
    updateSlot(memberId, itemId, (s) => {
      const value = size?.trim();
      if (!value) return { ...s, request: null };
      if (s.request?.size === value) return s;
      return { ...s, request: { size: value, requestedAt: todayIso(), passedOn: null } };
    }),

  /** Teil wurde ausgegeben: die neue Größe ist jetzt die aktuelle. */
  received: (memberId: string, itemId: string) =>
    updateSlot(memberId, itemId, (s) => (s.request ? { current: s.request.size, request: null } : s)),

  /** Liste ging an den Kleiderwart: die genannten Wünsche als weitergegeben markieren. */
  async markPassedOn(keys: { memberId: string; itemId: string }[], date = todayIso()): Promise<void> {
    for (const { memberId, itemId } of keys) {
      await updateSlot(memberId, itemId, (s) =>
        s.request && !s.request.passedOn ? { ...s, request: { ...s.request, passedOn: date } } : s,
      );
    }
  },
};

export const clothingItemRepo = {
  async add(name: string, sizes: string[]): Promise<ClothingItem> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name fehlt.');
    const last = await db.clothingItems.orderBy('order').last();
    const item: ClothingItem = { id: newId(), name: trimmed, sizes, order: (last?.order ?? -1) + 1 };
    await db.clothingItems.put(item);
    await markChanged('clothingItems', item.id);
    return item;
  },

  async update(id: string, name: string, sizes: string[]): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name fehlt.');
    await db.clothingItems.update(id, { name: trimmed, sizes });
    await markChanged('clothingItems', id);
  },

  /** Entfernt das Kleidungsstück aus der Tabelle (die eingetragenen Größen dazu werden nicht mehr angezeigt). */
  async remove(id: string): Promise<void> {
    await db.clothingItems.delete(id);
    await markChanged('clothingItems', id, true);
  },

  /** Mit dem Nachbarn tauschen (-1 = nach vorn, 1 = nach hinten). */
  async move(id: string, dir: -1 | 1): Promise<void> {
    const list = await db.clothingItems.orderBy('order').toArray();
    const i = list.findIndex((it) => it.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const [a, b] = [list[i]!, list[j]!];
    // Reihenfolge neu durchzählen, damit doppelte Werte (z. B. von zwei Geräten) verschwinden.
    const order = list.map((it) => it.id);
    order[i] = b.id;
    order[j] = a.id;
    for (const [n, itemId] of order.entries()) {
      const it = list.find((x) => x.id === itemId)!;
      if (it.order !== n) {
        await db.clothingItems.update(itemId, { order: n });
        await markChanged('clothingItems', itemId);
      }
    }
  },
};
