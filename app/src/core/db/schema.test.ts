import { describe, expect, it } from 'vitest';
import { db } from './db';

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
