import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db/db';
import { newProtokoll } from './model';
import { dismissConflict, loadConflicts, noteConflicts } from './conflicts';
import { ProtoError } from './http';
import { MIN_SERVER_API } from './schemaVersion';
import { performSync as syncAgainstServer, type ServerDoc } from './sync';

/** Die Server dieser Tests sprechen die Schnittstelle, die die App verlangt (außer ein Test sagt ausdrücklich etwas anderes). */
const performSync: typeof syncAgainstServer = (send, opts, store, blobs, text) =>
  syncAgainstServer(
    async (req) => {
      const res = await send(req);
      return 'api' in res ? res : { ...res, api: MIN_SERVER_API };
    },
    opts,
    store,
    blobs,
    // Ohne Angabe ist der Server für den Text nicht erreichbar (wie ohne Netz): Der Abgleich der Kopfdaten kommt trotzdem zum Ende.
    text ?? (async () => Promise.reject(new ProtoError('Keine Verbindung zum Server.', 0))),
  );


beforeEach(async () => {
  await Promise.all([db.protokolle.clear(), db.folders.clear(), db.outbox.clear(), db.kv.clear()]);
});

describe('Konflikt-Hinweise', () => {
  it('merkt Konflikte vor, neueste zuerst, und vergisst sie nach der Bestätigung', async () => {
    await noteConflicts([{ id: 'a', copyId: 'ka' }], db, 1);
    await noteConflicts([{ id: 'b', copyId: 'kb' }], db, 2);
    expect((await loadConflicts()).map((n) => n.copyId)).toEqual(['kb', 'ka']);
    await dismissConflict('ka');
    expect((await loadConflicts()).map((n) => n.copyId)).toEqual(['kb']);
    await dismissConflict('gibt-es-nicht');
    expect(await loadConflicts()).toHaveLength(1);
  });

  it('dieselbe Kopie steht nur einmal da (der Server schreibt sie fort) und rückt nach oben', async () => {
    await noteConflicts([{ id: 'a', copyId: 'ka' }], db, 1);
    await noteConflicts([{ id: 'b', copyId: 'kb' }], db, 2);
    await noteConflicts([{ id: 'a', copyId: 'ka' }], db, 3);
    expect(await loadConflicts()).toEqual([
      { id: 'a', copyId: 'ka', at: 3 },
      { id: 'b', copyId: 'kb', at: 2 },
    ]);
  });

  it('hebt höchstens 20 Hinweise auf', async () => {
    for (let i = 0; i < 30; i++) await noteConflicts([{ id: `o${i}`, copyId: `k${i}` }], db, i);
    expect(await loadConflicts()).toHaveLength(20);
  });

  it('ohne Konflikte bleibt der Speicher unberührt', async () => {
    await noteConflicts([]);
    expect(await db.kv.get('protokolle.conflicts')).toBeUndefined();
  });
});

describe('performSync meldet Konflikte', () => {
  const serverDoc = (id: string, over: Partial<ServerDoc> = {}): ServerDoc => ({
    id,
    title: 'Server',
    datum: '2026-10-01',
    beginn: '',
    ende: '',
    ort: '',
    leitung: '',
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    updatedAt: 1,
    rev: 5,
    deleted: false,
    ...over,
  });

  it('legt für jeden Konflikt einen Hinweis an, der den Abgleich überdauert', async () => {
    const p = { ...newProtokoll(), title: 'Gerät B', rev: 1 };
    await db.protokolle.add(p);
    await performSync(async () => ({
      rev: 10,
      changes: [serverDoc(p.id, { title: 'Gerät A', rev: 8 }), serverDoc('kopie-123456', { title: 'Gerät B (Konflikt)', rev: 10 })],
      folders: [],
      records: [],
      conflicts: [{ id: p.id, copyId: 'kopie-123456' }],
    }));
    expect((await loadConflicts()).map((n) => [n.id, n.copyId])).toEqual([[p.id, 'kopie-123456']]);
    // Ein weiterer Abgleich ohne Konflikt lässt den Hinweis stehen, bis er bestätigt wird.
    await performSync(async () => ({ rev: 11, changes: [], folders: [], records: [], conflicts: [] }));
    expect(await loadConflicts()).toHaveLength(1);
  });
});
