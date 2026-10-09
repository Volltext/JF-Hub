import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db/db';
import { newProtokoll } from './model';
import { performSync, type ServerDoc, type SyncRequest, type SyncResponse } from './sync';

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

beforeEach(async () => {
  await Promise.all([db.protokolle.clear(), db.folders.clear(), db.outbox.clear(), db.tasks.clear(), db.members.clear(), db.sessions.clear(), db.clothing.clear(), db.clothingItems.clear(), db.runs.clear(), db.lineupTemplates.clear(), db.kv.clear()]);
});

describe('performSync', () => {
  it('sendet nur ungesendete Änderungen und markiert sie danach als sauber', async () => {
    const a = { ...newProtokoll(), title: 'A' };
    const clean = { ...newProtokoll(), title: 'B', dirty: 0 as const, rev: 2 };
    await db.protokolle.bulkAdd([a, clean]);
    let seen: SyncRequest | undefined;
    const res = await performSync(async (req) => {
      seen = req;
      return { rev: 7, changes: [serverDoc(a.id, { title: 'A', updatedAt: a.updatedAt, rev: 7 })], folders: [], conflicts: [] };
    });
    expect(seen!.changes.map((c) => c.id)).toEqual([a.id]);
    expect(seen!.changes[0]!.baseRev).toBe(0);
    expect(res.pushed).toBe(1);
    const stored = await db.protokolle.get(a.id);
    expect(stored).toMatchObject({ dirty: 0, rev: 7 });
    expect((await db.kv.get('protokolle.rev'))?.value).toBe(7);
  });

  it('übernimmt neue Protokolle und Löschungen vom Server', async () => {
    const gone = { ...newProtokoll(), dirty: 0 as const, rev: 3 };
    await db.protokolle.add(gone);
    await performSync(async () => ({
      rev: 9,
      changes: [serverDoc('neu-123456'), serverDoc(gone.id, { deleted: true, rev: 9 })],
      folders: [],
      conflicts: [],
    }));
    expect(await db.protokolle.get('neu-123456')).toMatchObject({ title: 'Server', dirty: 0 });
    expect(await db.protokolle.get(gone.id)).toBeUndefined();
  });

  it('behält lokale Bearbeitungen, die während der Übertragung entstanden sind', async () => {
    const p = { ...newProtokoll(), title: 'v1' };
    await db.protokolle.add(p);
    await performSync(async (req) => {
      // Nutzer tippt weiter, während die Anfrage unterwegs ist
      await db.protokolle.update(p.id, { title: 'v2', updatedAt: p.updatedAt + 50, dirty: 1 });
      return { rev: 4, changes: [serverDoc(p.id, { title: 'v1', updatedAt: req.changes[0]!.updatedAt, rev: 4 })], folders: [], conflicts: [] };
    });
    expect(await db.protokolle.get(p.id)).toMatchObject({ title: 'v2', dirty: 1, rev: 4 });
  });

  it('ersetzt bei Konflikt die lokale Fassung und legt die Kopie an', async () => {
    const p = { ...newProtokoll(), title: 'Gerät B', rev: 1 };
    await db.protokolle.add(p);
    await performSync(async () => ({
      rev: 10,
      changes: [serverDoc(p.id, { title: 'Gerät A', rev: 8 }), serverDoc('kopie-123456', { title: 'Gerät B (Konflikt)', rev: 10 })],
      folders: [],
      conflicts: [{ id: p.id, copyId: 'kopie-123456' }],
    }));
    expect((await db.protokolle.get(p.id))?.title).toBe('Gerät A');
    expect((await db.protokolle.get('kopie-123456'))?.title).toBe('Gerät B (Konflikt)');
  });

  it('lässt lokale Daten bei Fehlern des Servers unverändert', async () => {
    const p = newProtokoll();
    await db.protokolle.add(p);
    await expect(performSync(async () => Promise.reject(new Error('offline')))).rejects.toThrow();
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 1 });
  });
});

describe('performSync: übersprungene Server-Dokumente', () => {
  const cursor = async () => (await db.kv.get('protokolle.rev'))?.value;

  it('rückt den Stand nicht über ein Dokument hinaus, das wegen lokaler Bearbeitung übersprungen wurde', async () => {
    const p = { ...newProtokoll(), title: 'v1', dirty: 0 as const, rev: 1 };
    await db.protokolle.add(p);
    await performSync(async () => {
      // Der Nutzer tippt los, während die Antwort mit der Fassung eines anderen Geräts unterwegs ist.
      await db.protokolle.update(p.id, { title: 'v2', updatedAt: p.updatedAt + 50, dirty: 1 });
      return { rev: 10, changes: [serverDoc(p.id, { title: 'fremd', rev: 8, updatedAt: 99 })], folders: [], conflicts: [] };
    });
    expect(await db.protokolle.get(p.id)).toMatchObject({ title: 'v2', dirty: 1, rev: 1 });
    // Der Stand bleibt vor dem übersprungenen Dokument, damit der Server es beim nächsten Abgleich erneut liefert.
    expect(await cursor()).toBe(7);
  });

  it('hält den Stand auch, wenn während der Übertragung weitergetippt wird und der Server eine fremde Fassung liefert', async () => {
    const p = { ...newProtokoll(), title: 'v1', rev: 1 };
    await db.protokolle.add(p);
    await performSync(async () => {
      await db.protokolle.update(p.id, { title: 'v2', updatedAt: p.updatedAt + 50, dirty: 1 });
      return {
        rev: 10,
        changes: [serverDoc(p.id, { title: 'fremd', rev: 8, updatedAt: 99 }), serverDoc('kopie-123456', { title: 'v1 (Konflikt)', rev: 9 })],
        folders: [],
        conflicts: [{ id: p.id, copyId: 'kopie-123456' }],
      };
    });
    expect(await db.protokolle.get(p.id)).toMatchObject({ title: 'v2', dirty: 1 });
    expect(await cursor()).toBe(7);
  });

  it('übernimmt das erneut gelieferte Dokument, sobald nichts mehr in Arbeit ist, und rückt dann vor', async () => {
    const p = { ...newProtokoll(), title: 'v2', rev: 1 };
    await db.protokolle.add(p);
    await db.kv.put({ key: 'protokolle.rev', value: 7 });
    await performSync(async () => ({
      rev: 10,
      changes: [serverDoc(p.id, { title: 'fremd', rev: 8, updatedAt: 99 }), serverDoc('kopie-123456', { title: 'v2 (Konflikt)', rev: 9 })],
      folders: [],
      conflicts: [{ id: p.id, copyId: 'kopie-123456' }],
    }));
    expect(await db.protokolle.get(p.id)).toMatchObject({ title: 'fremd', dirty: 0, rev: 8 });
    expect(await cursor()).toBe(10);
  });
});

describe('performSync: vom Server abgelehnte Protokolle', () => {
  const rejection = (id: string) => ({ rev: 6, changes: [], folders: [], records: [], conflicts: [], rejected: [{ kind: 'protocol' as const, id, reason: 'Protokoll zu groß' }] });

  it('merkt die Ablehnung, lädt dieselbe Fassung nicht erneut hoch und sendet sie erst nach einer Änderung oder mit „Alles neu“', async () => {
    const p = { ...newProtokoll(), title: 'Riesig' };
    await db.protokolle.add(p);
    const seen: string[][] = [];
    const send = async (req: SyncRequest) => {
      seen.push(req.changes.map((c) => c.id));
      return rejection(p.id);
    };
    const first = await performSync(send);
    expect(first.rejected).toBe(1);
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 1, rejected: 'Protokoll zu groß' }); // bleibt ungesendet und sichtbar markiert

    await performSync(send);
    expect(seen).toEqual([[p.id], []]); // beim zweiten Mal nicht noch einmal hochgeladen

    await performSync(send, { full: true }); // „Alles neu abgleichen“ versucht es wieder
    expect(seen[2]).toEqual([p.id]);
  });

  it('merkt die Ablehnung nicht, wenn inzwischen weitergetippt wurde (die neuere Fassung bekommt ihre Chance)', async () => {
    const p = { ...newProtokoll(), title: 'v1' };
    await db.protokolle.add(p);
    await performSync(async () => {
      await db.protokolle.update(p.id, { title: 'v2', updatedAt: p.updatedAt + 50, dirty: 1 });
      return rejection(p.id);
    });
    expect((await db.protokolle.get(p.id))?.rejected).toBeUndefined();
  });

  it('kommt ein älterer Server ohne `rejected` aus, ändert sich nichts', async () => {
    const p = newProtokoll();
    await db.protokolle.add(p);
    const res = await performSync(async () => ({ rev: 2, changes: [serverDoc(p.id, { updatedAt: p.updatedAt, rev: 2 })], folders: [], conflicts: [] }));
    expect(res.rejected).toBe(0);
  });
});

describe('performSync: Ordner', () => {
  it('sendet geänderte Ordner und übernimmt Ordner vom Server', async () => {
    await db.folders.add({ id: 'ordner-lokal', name: 'Lokal', parentId: '', rev: 0, updatedAt: 5, dirty: 1, deleted: 0 });
    let sent: SyncRequest | undefined;
    await performSync(async (req) => {
      sent = req;
      return {
        rev: 3,
        changes: [],
        folders: [
          { id: 'ordner-lokal', name: 'Lokal', parentId: '', updatedAt: 5, deleted: false, rev: 2 },
          { id: 'ordner-fremd', name: 'Fremd', parentId: 'ordner-lokal', updatedAt: 6, deleted: false, rev: 3 },
        ],
        conflicts: [],
      };
    });
    expect(sent!.folders).toEqual([{ id: 'ordner-lokal', name: 'Lokal', parentId: '', updatedAt: 5, deleted: false }]);
    expect(await db.folders.get('ordner-lokal')).toMatchObject({ dirty: 0, rev: 2 });
    expect(await db.folders.get('ordner-fremd')).toMatchObject({ parentId: 'ordner-lokal', dirty: 0 });
  });

  it('entfernt gelöschte Ordner lokal und behält neuere lokale Umbenennungen', async () => {
    await db.folders.bulkAdd([
      { id: 'ordner-weg', name: 'Weg', parentId: '', rev: 1, updatedAt: 1, dirty: 0, deleted: 0 },
      { id: 'ordner-neu', name: 'Mein neuer Name', parentId: '', rev: 1, updatedAt: 9, dirty: 1, deleted: 0 },
    ]);
    await performSync(async () => {
      await db.folders.update('ordner-neu', { name: 'Noch neuer', updatedAt: 20 });
      return {
        rev: 4,
        changes: [],
        folders: [
          { id: 'ordner-weg', name: 'Weg', parentId: '', updatedAt: 1, deleted: true, rev: 4 },
          { id: 'ordner-neu', name: 'Mein neuer Name', parentId: '', updatedAt: 9, deleted: false, rev: 3 },
        ],
        conflicts: [],
      };
    });
    expect(await db.folders.get('ordner-weg')).toBeUndefined();
    expect(await db.folders.get('ordner-neu')).toMatchObject({ name: 'Noch neuer', dirty: 1 });
  });
});
const task = (id: string, title: string) => ({ id, title, description: '', dueDate: null, priority: 'medium' as const, completed: false, createdAt: '2026-10-01T10:00:00.000Z', completedAt: null, sessionId: null });

describe('performSync: Mitglieder, Dienste, Aufgaben', () => {
  it('behält Vormerkungen, wenn der Server noch keine Datensätze kennt, und gleicht nach dem Update komplett ab', async () => {
    await db.tasks.add(task('task-lokal', 'Lokal'));
    await db.outbox.put({ key: 'tasks:task-lokal', collection: 'tasks', id: 'task-lokal', updatedAt: 10, deleted: 0 });
    await performSync(async () => ({ rev: 1, changes: [], folders: [], conflicts: [] }));
    expect(await db.outbox.count()).toBe(1);
    let sent: SyncRequest | undefined;
    await performSync(async (req) => {
      sent = req;
      return { rev: 2, changes: [], folders: [], records: [], conflicts: [] };
    });
    expect(sent!.since).toBe(0);
    expect(sent!.records.map((r) => r.id)).toEqual(['task-lokal']);
    expect((await db.kv.get('protokolle.serverRecords'))?.value).toBe(true);
  });

  it('sendet vorgemerkte Änderungen mit aktuellem Stand und übernimmt Datensätze vom Server', async () => {
    await db.kv.put({ key: 'protokolle.serverRecords', value: true });
    await db.tasks.add(task('task-lokal', 'Lokal'));
    await db.outbox.put({ key: 'tasks:task-lokal', collection: 'tasks', id: 'task-lokal', updatedAt: 10, deleted: 0 });
    let sent: SyncRequest | undefined;
    await performSync(async (req) => {
      sent = req;
      return {
        rev: 2,
        changes: [],
        folders: [],
        records: [{ collection: 'tasks', id: 'task-fremd', data: task('task-fremd', 'Vom Web'), updatedAt: 11, deleted: false, rev: 2 }],
        conflicts: [],
      };
    });
    expect(sent!.records).toEqual([{ collection: 'tasks', id: 'task-lokal', data: task('task-lokal', 'Lokal'), updatedAt: 10, deleted: false, shared: false }]);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.tasks.get('task-fremd'))?.title).toBe('Vom Web');
  });

  it('meldet gelöschte Datensätze und löscht sie lokal bei Server-Löschung', async () => {
    await db.tasks.add(task('task-weg', 'Weg'));
    await db.outbox.put({ key: 'tasks:task-gone', collection: 'tasks', id: 'task-gone', updatedAt: 5, deleted: 1 });
    let sent: SyncRequest | undefined;
    await performSync(async (req) => {
      sent = req;
      return { rev: 3, changes: [], folders: [], records: [{ collection: 'tasks', id: 'task-weg', data: {}, updatedAt: 9, deleted: true, rev: 3 }], conflicts: [] };
    });
    expect(sent!.records[0]).toMatchObject({ id: 'task-gone', deleted: true });
    expect(await db.tasks.get('task-weg')).toBeUndefined();
  });

  it('behält eine lokale Änderung, die während der Übertragung entstand', async () => {
    await db.tasks.add(task('task-edit', 'v1'));
    await db.outbox.put({ key: 'tasks:task-edit', collection: 'tasks', id: 'task-edit', updatedAt: 10, deleted: 0 });
    await performSync(async () => {
      await db.tasks.update('task-edit', { title: 'v2' });
      await db.outbox.put({ key: 'tasks:task-edit', collection: 'tasks', id: 'task-edit', updatedAt: 20, deleted: 0 });
      return { rev: 2, changes: [], folders: [], records: [{ collection: 'tasks', id: 'task-edit', data: task('task-edit', 'v1'), updatedAt: 10, deleted: false, rev: 2 }], conflicts: [] };
    });
    expect((await db.tasks.get('task-edit'))?.title).toBe('v2');
    expect(await db.outbox.get('tasks:task-edit')).toBeDefined();
  });
});

describe('performSync: neue Sammlungen (Kleidung)', () => {
  const clothing = { id: 'm1', items: { 'kombi-jacke': { current: '52', request: null } } };

  it('hält Kleidung zurück, solange der Server sie nicht annimmt, und sendet sie, sobald er es meldet', async () => {
    await db.kv.put({ key: 'protokolle.serverRecords', value: true });
    await db.clothing.add(clothing);
    await db.tasks.add(task('task-lokal', 'Lokal'));
    await db.outbox.bulkPut([
      { key: 'clothing:m1', collection: 'clothing', id: 'm1', updatedAt: 10, deleted: 0 },
      { key: 'tasks:task-lokal', collection: 'tasks', id: 'task-lokal', updatedAt: 10, deleted: 0 },
    ]);

    // Alter Server (meldet keine Sammlungen): nur Aufgaben senden, Kleidung bleibt vorgemerkt.
    let sent: SyncRequest | undefined;
    const r1 = await performSync(async (req) => {
      sent = req;
      return { rev: 2, changes: [], folders: [], records: [], conflicts: [] };
    });
    expect(sent!.records.map((r) => r.collection)).toEqual(['tasks']);
    expect(await db.outbox.get('clothing:m1')).toBeDefined();
    expect(r1.reuploaded).toBe(0);

    // Aktualisierter Server meldet seine Sammlungen: Nachlauf auslösen …
    const r2 = await performSync(async () => ({ rev: 2, changes: [], folders: [], records: [], collections: ['members', 'sessions', 'tasks', 'clothing', 'clothingItems'], conflicts: [] }));
    expect(r2.reuploaded).toBe(1);
    // … in dem die Kleidung mitgeht.
    await performSync(async (req) => {
      sent = req;
      return { rev: 3, changes: [], folders: [], records: [], collections: ['members', 'sessions', 'tasks', 'clothing', 'clothingItems'], conflicts: [] };
    });
    expect(sent!.records).toEqual([{ collection: 'clothing', id: 'm1', data: clothing, updatedAt: 10, deleted: false }]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('übernimmt Kleidung vom Server und überspringt unbekannte Sammlungen', async () => {
    await db.kv.put({ key: 'protokolle.serverRecords', value: true });
    await performSync(async () => ({
      rev: 4,
      changes: [],
      folders: [],
      records: [
        { collection: 'clothing', id: 'm1', data: clothing, updatedAt: 3, deleted: false, rev: 3 },
        { collection: 'zukunft' as never, id: 'x', data: {}, updatedAt: 4, deleted: false, rev: 4 },
      ],
      collections: ['members', 'sessions', 'tasks', 'clothing', 'clothingItems', 'zukunft'],
      conflicts: [],
    }));
    expect(await db.clothing.get('m1')).toEqual(clothing);
    expect((await db.kv.get('protokolle.serverCollections'))?.value).toEqual(['members', 'sessions', 'tasks', 'clothing', 'clothingItems']);
  });
});

describe('performSync: Stand passt nicht zum Server', () => {
  it('sendet bei Reset alles erneut, was der Server nicht kennt', async () => {
    await db.kv.put({ key: 'protokolle.rev', value: 50 });
    const known = { ...newProtokoll(), dirty: 0 as const, rev: 40, title: 'Bekannt' };
    const unknown = { ...newProtokoll(), dirty: 0 as const, rev: 41, title: 'Unbekannt' };
    await db.protokolle.bulkAdd([known, unknown]);
    await db.tasks.add(task('task-unbek', 'Unbekannt'));
    const r = await performSync(async () => ({
      rev: 3,
      epoch: 'neu',
      reset: true,
      changes: [serverDoc(known.id, { title: 'Bekannt', rev: 2 })],
      folders: [],
      records: [],
      conflicts: [],
    }));
    expect(await db.protokolle.get(unknown.id)).toMatchObject({ rev: 0, dirty: 1 });
    expect(await db.protokolle.get(known.id)).toMatchObject({ dirty: 0, rev: 2 });
    expect(await db.outbox.get('tasks:task-unbek')).toBeDefined();
    expect(r.reuploaded).toBe(2);
    expect((await db.kv.get('protokolle.epoch'))?.value).toBe('neu');
    expect((await db.kv.get('protokolle.rev'))?.value).toBe(3);
  });

  it('„Alles neu abgleichen“ fragt ab Revision 0 und löst denselben Abgleich aus', async () => {
    await db.kv.put({ key: 'protokolle.rev', value: 9 });
    let since = -1;
    await performSync(async (req) => {
      since = req.since;
      return { rev: 9, changes: [], folders: [], records: [], conflicts: [] };
    }, { full: true });
    expect(since).toBe(0);
  });
});
// Typprüfung der Antwortform
export type _Check = SyncResponse;

describe('performSync: Besitzer und Sichtbarkeit', () => {
  it('sendet die Sichtbarkeit von Protokollen und Aufgaben mit', async () => {
    const open = { ...newProtokoll('', true), title: 'Offen' };
    const closed = { ...newProtokoll(), title: 'Privat' };
    await db.protokolle.bulkAdd([open, closed]);
    await db.kv.put({ key: 'protokolle.serverRecords', value: true });
    await db.tasks.add({ ...task('task-offen', 'Offen'), shared: true });
    await db.outbox.put({ key: 'tasks:task-offen', collection: 'tasks', id: 'task-offen', updatedAt: 10, deleted: 0 });
    let sent: SyncRequest | undefined;
    await performSync(async (req) => {
      sent = req;
      return { rev: 3, changes: [], folders: [], records: [], conflicts: [] };
    });
    const byId = new Map(sent!.changes.map((c) => [c.id, c.shared]));
    expect(byId.get(open.id)).toBe(true);
    expect(byId.get(closed.id)).toBe(false);
    expect(sent!.records[0]).toMatchObject({ id: 'task-offen', shared: true });
  });

  it('übernimmt Besitzer und Sichtbarkeit vom Server und merkt sich das Benutzerverzeichnis', async () => {
    await db.kv.put({ key: 'protokolle.serverRecords', value: true });
    await performSync(async () => ({
      rev: 4,
      changes: [serverDoc('von-anna-1', { shared: true, ownerId: 'u-anna' })],
      folders: [],
      records: [{ collection: 'tasks', id: 'task-anna', data: { ...task('task-anna', 'Von Anna'), shared: true, ownerId: 'u-anna' }, updatedAt: 5, deleted: false, rev: 4, ownerId: 'u-anna' }],
      users: [{ id: 'u-anna', name: 'Anna' }],
      conflicts: [],
    }));
    expect(await db.protokolle.get('von-anna-1')).toMatchObject({ shared: true, ownerId: 'u-anna' });
    expect(await db.tasks.get('task-anna')).toMatchObject({ shared: true, ownerId: 'u-anna' });
    expect((await db.kv.get('directory'))?.value).toEqual([{ id: 'u-anna', name: 'Anna' }]);
  });

  it('entfernt lokale Kopien, wenn der Besitzer sie wieder privat gestellt hat (Löschhinweis ohne Outbox-Eintrag)', async () => {
    await db.kv.put({ key: 'protokolle.serverRecords', value: true });
    const doc = { ...newProtokoll('', true), dirty: 0 as const, rev: 3, ownerId: 'u-anna' };
    await db.protokolle.add(doc);
    await db.tasks.add({ ...task('task-anna', 'Von Anna'), shared: true, ownerId: 'u-anna' });
    await performSync(async () => ({
      rev: 9,
      changes: [serverDoc(doc.id, { deleted: true, rev: 9 })],
      folders: [],
      records: [{ collection: 'tasks', id: 'task-anna', data: {}, updatedAt: 9, deleted: true, rev: 9 }],
      conflicts: [],
    }));
    expect(await db.protokolle.get(doc.id)).toBeUndefined();
    expect(await db.tasks.get('task-anna')).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it('Läufe und Vorlagen: senden, was vorgemerkt ist, und übernehmen, was vom Server kommt', async () => {
    const run = { id: 'run-lokal', createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', mode: 'a', totalMs: 90_000, markers: [], knotDurationMs: null, taskTimers: {}, notes: '', scoring: null, lsp: null, lineupSnapshot: { assignments: {}, memberNames: {} } };
    await db.runs.add(run);
    await db.outbox.put({ key: 'runs:run-lokal', collection: 'runs', id: 'run-lokal', updatedAt: 10, deleted: 0 });
    const known = ['members', 'sessions', 'tasks', 'clothing', 'clothingItems', 'runs', 'lineupTemplates'];
    await db.kv.bulkPut([
      { key: 'protokolle.serverCollections', value: known },
      { key: 'protokolle.serverRecords', value: true },
    ]);
    let sent: SyncRequest | undefined;
    await performSync(async (req) => {
      sent = req;
      return {
        rev: 4,
        changes: [],
        folders: [],
        records: [{ collection: 'lineupTemplates', id: 'tpl-fremd', data: { id: 'tpl-fremd', name: 'Von Anna', createdAt: '2026-10-02T00:00:00.000Z', assignments: {} }, updatedAt: 11, deleted: false, rev: 4 }],
        collections: known,
        conflicts: [],
      };
    });
    expect(sent!.records).toEqual([{ collection: 'runs', id: 'run-lokal', data: run, updatedAt: 10, deleted: false }]);
    expect(await db.lineupTemplates.get('tpl-fremd')).toMatchObject({ name: 'Von Anna' });
    expect(await db.outbox.count()).toBe(0);
  });

  it('Nach einer wiederhergestellten Server-Datenbank gehen vorhandene Läufe erneut hoch', async () => {
    await db.runs.add({ id: 'run-1', createdAt: '', updatedAt: '', mode: 'a', totalMs: 1, markers: [], knotDurationMs: null, taskTimers: {}, notes: '', scoring: null, lsp: null, lineupSnapshot: { assignments: {}, memberNames: {} } });
    await db.kv.bulkPut([
      { key: 'protokolle.rev', value: 5 },
      { key: 'protokolle.epoch', value: 'alt' },
      { key: 'protokolle.serverRecords', value: true },
      { key: 'protokolle.serverCollections', value: ['members', 'sessions', 'tasks', 'clothing', 'clothingItems', 'runs', 'lineupTemplates'] },
    ]);
    const res = await performSync(async () => ({ rev: 2, epoch: 'neu', reset: true, changes: [], folders: [], records: [], collections: ['members', 'sessions', 'tasks', 'clothing', 'clothingItems', 'runs', 'lineupTemplates'], conflicts: [] }));
    expect(res.reuploaded).toBe(1);
    expect(await db.outbox.get('runs:run-1')).toBeDefined();
  });
});
