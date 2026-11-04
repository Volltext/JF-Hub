import { db } from '@/core/db/db';

/** Offene Kleidungswünsche aktiver Mitglieder (nur zu vorhandenen Kleidungsstücken); `fresh` = noch nicht weitergegeben. */
export async function clothingCounts(): Promise<{ open: number; fresh: number }> {
  const active = new Set((await db.members.filter((m) => m.active).toArray()).map((m) => m.id));
  const itemIds = new Set(await db.clothingItems.toCollection().primaryKeys());
  let open = 0;
  let fresh = 0;
  for (const rec of await db.clothing.toArray()) {
    if (!active.has(rec.id)) continue;
    for (const [itemId, slot] of Object.entries(rec.items)) {
      if (!slot.request || !itemIds.has(itemId)) continue;
      open++;
      if (!slot.request.passedOn) fresh++;
    }
  }
  return { open, fresh };
}
