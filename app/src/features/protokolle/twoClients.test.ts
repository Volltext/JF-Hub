import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { HubDb } from '@/core/db/db';
import { openDb } from '../../../../server/src/db';
import { applySync, type SyncRequest as ServerRequest, type SyncUser } from '../../../../server/src/sync';
import { newProtokoll } from './model';
import { performSync, type SyncResponse } from './sync';

/**
 * Zwei Geräte gleichen sich gegen den echten Server-Code ab (`applySync` mit einer Datenbank im Speicher).
 * So stehen Client- und Server-Regeln für Konflikte in einem Test zusammen.
 */
const ANNA: SyncUser = { id: 'user-anna', role: 'betreuer' };
const BEN: SyncUser = { id: 'user-ben', role: 'betreuer' };

let server: DatabaseSync;
let anna: HubDb;
let ben: HubDb;
let n = 0;
let clock = 1_000;

beforeEach(() => {
  server = openDb(':memory:');
  n++;
  anna = new HubDb(`test-anna-${n}`);
  ben = new HubDb(`test-ben-${n}`);
});
afterEach(async () => {
  await anna.delete();
  await ben.delete();
});

const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Ein Abgleich eines Geräts. `during` läuft, während die Anfrage unterwegs ist (der Nutzer tippt weiter). */
function syncOf(store: HubDb, user: SyncUser, during?: () => Promise<void>) {
  return performSync(
    async (req) => {
      const res = applySync(server, wire(req) as unknown as ServerRequest, user);
      await during?.();
      return wire(res) as unknown as SyncResponse;
    },
    {},
    store,
  );
}

const edit = async (store: HubDb, id: string, title: string): Promise<void> => {
  await store.protokolle.update(id, { title, updatedAt: ++clock, dirty: 1 });
};
const copies = () => (server.prepare("SELECT COUNT(*) AS n FROM protocols WHERE title LIKE '% (Konflikt)'").get() as { n: number }).n;

async function sharedDoc(): Promise<string> {
  const doc = { ...newProtokoll('', true), title: 'Sitzung' };
  await anna.protokolle.add(doc);
  await syncOf(anna, ANNA);
  await syncOf(ben, BEN);
  expect((await ben.protokolle.get(doc.id))?.title).toBe('Sitzung');
  return doc.id;
}

describe('zwei Geräte, ein veröffentlichtes Protokoll', () => {
  it('gleichzeitiges Bearbeiten ergibt genau eine Kopie und geht nichts verloren', async () => {
    const id = await sharedDoc();
    await edit(anna, id, 'Anna: Anfang');
    await edit(ben, id, 'Ben: Anfang');
    await syncOf(ben, BEN); // Ben ist zuerst beim Server
    await syncOf(anna, ANNA);
    expect(copies()).toBe(1);
    expect(await anna.protokolle.get(id)).toMatchObject({ title: 'Ben: Anfang', dirty: 0 });
    expect(server.prepare("SELECT title FROM protocols WHERE title LIKE '% (Konflikt)'").get()).toMatchObject({ title: 'Anna: Anfang (Konflikt)' });
  });

  it('weiteres Tippen während des Abgleichs erzeugt keine weiteren Kopien', async () => {
    const id = await sharedDoc();
    await edit(anna, id, 'Anna: Anfang');
    await edit(ben, id, 'Ben: Anfang');
    await syncOf(ben, BEN);

    // Anna tippt bei jedem Abgleich weiter; ihre Fassung des Servers bleibt dabei veraltet.
    for (let i = 0; i < 4; i++) await syncOf(anna, ANNA, () => edit(anna, id, `Anna: Stand ${i}`));
    expect(copies()).toBe(1);
    expect(await anna.protokolle.get(id)).toMatchObject({ title: 'Anna: Stand 3', dirty: 1 }); // die Arbeit am Gerät bleibt erhalten

    // Sobald Anna aufhört, übernimmt ihr Gerät die Fassung des Servers; ihre Arbeit liegt in der einen Kopie.
    await syncOf(anna, ANNA);
    expect(copies()).toBe(1);
    expect(await anna.protokolle.get(id)).toMatchObject({ title: 'Ben: Anfang', dirty: 0 });
    expect(server.prepare("SELECT title FROM protocols WHERE title LIKE '% (Konflikt)'").get()).toMatchObject({ title: 'Anna: Stand 3 (Konflikt)' });
    await syncOf(anna, ANNA);
    expect(copies()).toBe(1);
  });

  it('eine verlorene Antwort führt bei der Wiederholung nicht zu einer Kopie', async () => {
    const doc = { ...newProtokoll('', true), title: 'Sitzung' };
    await anna.protokolle.add(doc);
    await expect(
      performSync(
        async (req) => {
          applySync(server, wire(req) as unknown as ServerRequest, ANNA); // der Server hat gespeichert …
          throw new Error('Antwort verloren'); // … die Antwort kommt nicht an
        },
        {},
        anna,
      ),
    ).rejects.toThrow();
    expect(await anna.protokolle.get(doc.id)).toMatchObject({ dirty: 1, rev: 0 });

    await syncOf(anna, ANNA);
    expect(copies()).toBe(0);
    const stored = await anna.protokolle.get(doc.id);
    expect(stored).toMatchObject({ dirty: 0 });
    expect(stored!.rev).toBeGreaterThan(0);
  });

  it('dieselbe Änderung auf einem veralteten Stand wird nicht zur Kopie, wenn der Inhalt schon beim Server liegt', async () => {
    const id = await sharedDoc();
    await edit(anna, id, 'Gleicher Titel');
    await edit(ben, id, 'Gleicher Titel');
    await syncOf(ben, BEN);
    await syncOf(anna, ANNA);
    expect(copies()).toBe(0);
    expect(await anna.protokolle.get(id)).toMatchObject({ title: 'Gleicher Titel', dirty: 0 });
  });
});
