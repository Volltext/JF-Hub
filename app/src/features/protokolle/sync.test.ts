import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db/db';
import { wipeLocalData } from '@/core/db/wipe';
import { putLocalBlob } from '@/core/db/blobs';
import { newProtokoll, type Protokoll } from './model';
import type { BlobTransport } from './blobSync';
import type { ExchangeTransport } from './collab/wire';
import { ProtoError } from './http';
import { MIN_SERVER_API } from './schemaVersion';
import { performSync as syncAgainstServer, type ServerDoc, type SyncRequest, type SyncResponse } from './sync';

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
  ymode: 1,
  metaAt: {},
  ...over,
});

/** So sieht der Server eine lokale Zeile, nachdem er ihre Kopfdaten angenommen hat. */
const echo = (p: Protokoll, over: Partial<ServerDoc> = {}): ServerDoc =>
  serverDoc(p.id, {
    title: p.title,
    datum: p.datum,
    beginn: p.beginn,
    ende: p.ende,
    ort: p.ort,
    leitung: p.leitung,
    folderId: p.folderId ?? '',
    shared: p.shared === true,
    content: p.content,
    updatedAt: p.updatedAt,
    metaAt: p.metaAt,
    ...over,
  });

beforeEach(async () => {
  await Promise.all([db.protokolle.clear(), db.ydocs.clear(), db.folders.clear(), db.outbox.clear(), db.tasks.clear(), db.members.clear(), db.sessions.clear(), db.clothing.clear(), db.clothingItems.clear(), db.runs.clear(), db.lineupTemplates.clear(), db.blobs.clear(), db.blobData.clear(), db.kv.clear()]);
});

describe('performSync', () => {
  it('sendet nur ungesendete Änderungen und markiert sie danach als sauber', async () => {
    const a = { ...newProtokoll(), title: 'A' };
    const clean = { ...newProtokoll(), title: 'B', dirty: 0 as const, rev: 2 };
    await db.protokolle.bulkAdd([a, clean]);
    let seen: SyncRequest | undefined;
    const res = await performSync(async (req) => {
      seen = req;
      return { rev: 7, changes: [echo(a, { rev: 7 })], folders: [], conflicts: [] };
    });
    expect(seen!.protocols.map((c) => c.id)).toEqual([a.id]);
    expect(seen!.protocols[0]!.baseRev).toBe(0);
    expect(res.pushed).toBe(1);
    const stored = await db.protokolle.get(a.id);
    expect(stored).toMatchObject({ dirty: 0, rev: 7 });
    expect((await db.kv.get('protokolle.rev'))?.value).toBe(7);
  });

  it('sendet nur die Kopfdaten mit ihren Änderungszeiten, nie den Text', async () => {
    const a = { ...newProtokoll(), title: 'A', metaAt: { title: 1000, datum: 500 } };
    await db.protokolle.add(a);
    let seen: SyncRequest | undefined;
    await performSync(async (req) => {
      seen = req;
      return { rev: 1, changes: [], folders: [], conflicts: [] };
    });
    const sent = seen!.protocols[0]!;
    expect(sent).not.toHaveProperty('content');
    expect(sent.metaAt).toEqual({ title: 1000, datum: 500 }); // Felder ohne eigene Zeit erheben keinen Anspruch (die Zeit der Zeile rückt mit jeder Textänderung vor)
    expect(JSON.stringify(seen)).not.toContain('"changes"');
  });

  it('ein Fehler im Text-Schritt, der kein Verbindungsfehler ist (zum Beispiel ein Speicherfehler auf dem Gerät), wird gemeldet statt verschwiegen', async () => {
    const broken: ExchangeTransport = async () => {
      throw new Error('IndexedDB nicht beschreibbar');
    };
    await db.protokolle.add({ ...newProtokoll(), id: 'bekannt-001', dirty: 0, rev: 3, shared: true });
    const send = async () => ({ rev: 4, changes: [serverDoc('bekannt-001', { rev: 3, shared: true })], folders: [], records: [], conflicts: [] }) as SyncResponse;
    await expect(performSync(send, {}, db, undefined, broken)).rejects.toThrow(/IndexedDB/);
    // ein Verbindungsfehler dagegen ist keiner: Der Abgleich der Kopfdaten gilt
    const offline: ExchangeTransport = async () => {
      throw new ProtoError('Keine Verbindung.', 0);
    };
    await expect(performSync(send, {}, db, undefined, offline)).resolves.toMatchObject({ text: null });
  });

  it('eine Antwort, die erst nach dem Abmelden (Löschen der lokalen Daten) eintrifft, legt nichts mehr an', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const running = performSync(async () => {
      await gate;
      return { rev: 9, epoch: 'E1', changes: [serverDoc('privat-0001', { title: 'Privates von Anna', shared: false, rev: 9 })], folders: [], records: [], conflicts: [] } as SyncResponse;
    });
    const outcome = running.then(() => 'fertig', (e: unknown) => (e instanceof ProtoError ? `Fehler ${e.status}` : 'anderer Fehler'));
    await new Promise((r) => setTimeout(r, 20));
    await wipeLocalData(); // Abmelden, während die Anfrage unterwegs ist
    release();
    expect(await outcome).toBe('Fehler 401'); // der Abgleich gilt als abgebrochen (nicht mehr angemeldet) …
    expect(await db.protokolle.toArray()).toEqual([]); // … und hat nichts vom vorigen Konto zurückgebracht
    expect(await db.kv.get('protokolle.rev')).toBeUndefined();
    expect(await db.kv.get('protokolle.epoch')).toBeUndefined();
  });

  it('übernimmt neue Protokolle und Löschungen vom Server', async () => {
    const gone = { ...newProtokoll(), dirty: 0 as const, rev: 3 };
    await db.protokolle.add(gone);
    await performSync(async () => ({
      rev: 9,
      changes: [serverDoc('neu-123456', { metaAt: { title: 77 } }), serverDoc(gone.id, { deleted: true, rev: 9 })],
      folders: [],
      conflicts: [],
    }));
    expect(await db.protokolle.get('neu-123456')).toMatchObject({ title: 'Server', dirty: 0, metaAt: { title: 77 }, content: { type: 'doc' } });
    expect(await db.protokolle.get(gone.id)).toBeUndefined();
  });

  it('lässt lokale Daten bei Fehlern des Servers unverändert', async () => {
    const p = newProtokoll();
    await db.protokolle.add(p);
    await expect(performSync(async () => Promise.reject(new Error('offline')))).rejects.toThrow();
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 1 });
  });

  it('der Text kommt nur über den Austausch: ein veränderter Schnappschuss des Servers ersetzt den lokalen Text nur, wenn hier nichts ungesendet ist', async () => {
    const clean = { ...newProtokoll(), dirty: 0 as const, rev: 2, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alt' }] }] } };
    const unsent = { ...newProtokoll(), dirty: 0 as const, rev: 2, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'lokal getippt' }] }] } };
    await db.protokolle.bulkAdd([clean, unsent]);
    await db.ydocs.put({ id: unsent.id, update: new Uint8Array([0, 0]), dirty: 1, seq: 1 });
    const fromServer = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'vom Server' }] }] };
    await performSync(async () => ({ rev: 8, changes: [echo(clean, { content: fromServer, rev: 8 }), echo(unsent, { content: fromServer, rev: 8 })], folders: [], conflicts: [] }));
    expect((await db.protokolle.get(clean.id))!.content).toEqual(fromServer);
    expect((await db.protokolle.get(unsent.id))!.content).toEqual(unsent.content); // der ungesendete Text bleibt sichtbar
  });

  it('ein Protokoll, das der Server noch nicht umgestellt hat, ist nur lesbar; ab der Umstellung nicht mehr', async () => {
    await performSync(async () => ({ rev: 2, changes: [serverDoc('alt-000001', { ymode: 0 })], folders: [], conflicts: [] }));
    expect((await db.protokolle.get('alt-000001'))!.legacy).toBe(true);
    await performSync(async () => ({ rev: 3, changes: [serverDoc('alt-000001', { ymode: 1, rev: 3 })], folders: [], conflicts: [] }));
    expect((await db.protokolle.get('alt-000001'))!.legacy).toBeUndefined();
  });

  it('merkt sich, bis zu welcher Revision der Text bekannt ist, auch wenn die Zeile neu geschrieben wird', async () => {
    const p = { ...newProtokoll(), dirty: 0 as const, rev: 2, textRev: 2 };
    await db.protokolle.add(p);
    await performSync(async () => ({ rev: 6, changes: [echo(p, { rev: 6, title: 'Neuer Titel', metaAt: { title: 99 } })], folders: [], conflicts: [] }));
    expect(await db.protokolle.get(p.id)).toMatchObject({ rev: 6, textRev: 2, title: 'Neuer Titel' }); // der Text ist noch der von Revision 2
  });
});

describe('performSync: Kopfdaten Feld für Feld', () => {
  const rowOf = (over: Partial<Protokoll> = {}): Protokoll => ({ ...newProtokoll(), title: 'Lokal', ort: 'Alt', dirty: 1, rev: 3, updatedAt: 500, metaAt: { title: 400, ort: 100, datum: 100, beginn: 100, ende: 100, leitung: 100, folderId: 100, shared: 100 }, ...over });

  it('jüngere lokale Felder bleiben und gehen beim nächsten Abgleich hoch, ältere nimmt der Server', async () => {
    const p = rowOf();
    await db.protokolle.add(p);
    await performSync(async () => ({
      rev: 8,
      // Der Server hat den Ort neu (Zeit 300 > 100), den Titel aber nur alt (Zeit 200 < 400 lokal)
      changes: [echo(p, { title: 'Server-Titel', ort: 'Neuer Ort', rev: 8, metaAt: { ...p.metaAt, title: 200, ort: 300 } })],
      folders: [],
      conflicts: [],
    }));
    expect(await db.protokolle.get(p.id)).toMatchObject({ title: 'Lokal', ort: 'Neuer Ort', dirty: 1, rev: 8, metaAt: { title: 400, ort: 300 } });
  });

  it('ein Feld, das dieses Gerät nie geändert hat, erhebt keinen Anspruch: Es gilt der Wert des Servers, auch wenn die Zeile jünger ist', async () => {
    // Zeile aus der Zeit vor 3.0.0: nur der Titel wurde hier geändert; die Zeit der Zeile (nach jedem Text-Schreiben neu) ist jünger als alles beim Server
    const p = rowOf({ ort: 'Alt', updatedAt: 9_000, metaAt: { title: 400 } });
    await db.protokolle.add(p);
    await performSync(async () => ({ rev: 8, changes: [echo(p, { ort: 'Halle', title: 'Server', rev: 8, metaAt: { title: 200, ort: 300 } })], folders: [], conflicts: [] }));
    expect(await db.protokolle.get(p.id)).toMatchObject({ title: 'Lokal', ort: 'Halle', dirty: 1, metaAt: { title: 400, ort: 300 } });
  });

  it('sind die Werte gleich, ist nichts mehr offen', async () => {
    const p = rowOf();
    await db.protokolle.add(p);
    await performSync(async () => ({ rev: 8, changes: [echo(p, { rev: 8, metaAt: { ...p.metaAt, title: 450 } })], folders: [], conflicts: [] }));
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 0, metaAt: { title: 450 } });
  });

  it('gleiche Zeit: der größere Wert gewinnt, auf allen Geräten gleich', async () => {
    const p = rowOf({ title: 'Anna', metaAt: { title: 400 } });
    await db.protokolle.add(p);
    await performSync(async () => ({ rev: 8, changes: [echo(p, { title: 'Ben', rev: 8, metaAt: { title: 400 } })], folders: [], conflicts: [] }));
    expect((await db.protokolle.get(p.id))!.title).toBe('Ben'); // 'Ben' > 'Anna'
    const q = rowOf({ id: 'q-00000001', title: 'Zora', metaAt: { title: 400 } });
    await db.protokolle.add(q);
    await performSync(async () => ({ rev: 9, changes: [echo(q, { title: 'Ben', rev: 9, metaAt: { title: 400 } })], folders: [], conflicts: [] }));
    expect(await db.protokolle.get(q.id)).toMatchObject({ title: 'Zora', dirty: 1 });
  });

  it('behält Änderungen, die während der Übertragung entstanden sind, ohne die Antwort zu überschreiben', async () => {
    const p = rowOf({ title: 'v1', metaAt: { title: 400 } });
    await db.protokolle.add(p);
    await performSync(async (req) => {
      // Der Nutzer tippt weiter, während die Anfrage unterwegs ist
      await db.protokolle.update(p.id, { title: 'v2', updatedAt: 600, dirty: 1, metaAt: { ...p.metaAt, title: 600 } });
      return { rev: 4, changes: [echo(p, { title: 'v1', rev: 4, metaAt: { title: req.protocols[0]!.metaAt.title } })], folders: [], conflicts: [] };
    });
    expect(await db.protokolle.get(p.id)).toMatchObject({ title: 'v2', dirty: 1, rev: 4, metaAt: { title: 600 } });
  });

  it('ein Dokument, das hier nicht vorgemerkt war, wird sofort übernommen (kein Festhalten des Stands mehr)', async () => {
    const p = { ...newProtokoll(), title: 'v1', dirty: 0 as const, rev: 1, metaAt: { title: 10 } };
    await db.protokolle.add(p);
    await performSync(async () => {
      await db.protokolle.update(p.id, { title: 'v2', dirty: 1, metaAt: { title: 20 }, updatedAt: 99 });
      return { rev: 10, changes: [echo(p, { title: 'fremd', rev: 8, updatedAt: 55, metaAt: { title: 15 } })], folders: [], conflicts: [] };
    });
    // die lokale Änderung (20) ist jünger als die fremde (15): sie bleibt; der Stand rückt trotzdem vor
    expect(await db.protokolle.get(p.id)).toMatchObject({ title: 'v2', dirty: 1, rev: 8 });
    expect((await db.kv.get('protokolle.rev'))?.value).toBe(10);
  });

  it('ein lokal gelöschtes Protokoll bleibt zum Löschen vorgemerkt; verweigert der Server das Löschen, kommt es zurück', async () => {
    const mine = { ...newProtokoll(), dirty: 1 as const, rev: 3, deleted: 1 as const };
    await db.protokolle.add(mine);
    // das Löschen war Teil der Anfrage, der Server lässt es nicht zu und liefert das Protokoll lebendig zurück
    await performSync(async () => ({ rev: 4, changes: [echo(mine, { rev: 4 })], folders: [], conflicts: [] }));
    expect(await db.protokolle.get(mine.id)).toMatchObject({ deleted: 0, dirty: 0 });

    // anders, wenn erst nach dem Senden gelöscht wurde
    const later = { ...newProtokoll(), dirty: 0 as const, rev: 3 };
    await db.protokolle.add(later);
    await performSync(async () => {
      await db.protokolle.update(later.id, { deleted: 1, dirty: 1 });
      return { rev: 5, changes: [echo(later, { rev: 5 })], folders: [], conflicts: [] };
    });
    expect(await db.protokolle.get(later.id)).toMatchObject({ deleted: 1, dirty: 1 });
  });

  it('wird ein Protokoll gelöscht oder zurückgezogen, während hier ungesendeter Text liegt, bleibt der Text als Kopie erhalten', async () => {
    const p = { ...newProtokoll('', true), dirty: 0 as const, rev: 3, title: 'Weg', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'wichtig' }] }] } };
    await db.protokolle.add(p);
    const text = new Y.Doc();
    const para = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, 'wichtig');
    para.insert(0, [t]);
    text.getXmlFragment('body').insert(0, [para]);
    await db.ydocs.put({ id: p.id, update: Y.encodeStateAsUpdate(text), dirty: 1, seq: 1 });
    await performSync(async () => ({ rev: 9, changes: [serverDoc(p.id, { deleted: true, rev: 9 })], folders: [], conflicts: [] }));
    expect(await db.protokolle.get(p.id)).toBeUndefined();
    expect(await db.ydocs.get(p.id)).toBeUndefined();
    const copy = (await db.protokolle.toArray())[0]!;
    expect(copy).toMatchObject({ title: 'Weg (lokale Fassung)', rev: 0, dirty: 1, shared: false });
    expect(await db.ydocs.get(copy.id)).toMatchObject({ dirty: 1 });
  });
});

describe('performSync: vom Server abgelehnte Protokolle', () => {
  const rejection = (id: string) => ({ rev: 6, changes: [], folders: [], records: [], conflicts: [], rejected: [{ kind: 'protocol' as const, id, reason: 'Protokoll zu groß' }] });

  it('merkt die Ablehnung, lädt dieselbe Fassung nicht erneut hoch und sendet sie erst nach einer Änderung oder mit „Alles neu“', async () => {
    const p = { ...newProtokoll(), title: 'Riesig' };
    await db.protokolle.add(p);
    const seen: string[][] = [];
    const send = async (req: SyncRequest) => {
      seen.push(req.protocols.map((c) => c.id));
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
      await db.protokolle.update(p.id, { title: 'v2', updatedAt: p.updatedAt + 50, dirty: 1, metaAt: { ...p.metaAt, title: p.updatedAt + 50 } });
      return rejection(p.id);
    });
    expect((await db.protokolle.get(p.id))?.rejected).toBeUndefined();
  });

  it('kommt ein älterer Server ohne `rejected` aus, ändert sich nichts', async () => {
    const p = newProtokoll();
    await db.protokolle.add(p);
    const res = await performSync(async () => ({ rev: 2, changes: [echo(p, { rev: 2 })], folders: [], conflicts: [] }));
    expect(res.rejected).toBe(0);
  });
});

describe('performSync: Schnittstelle des Servers', () => {
  it('meldet einen Server, dessen Schnittstelle zu alt ist, und lässt lokale Daten unberührt', async () => {
    const p = newProtokoll();
    await db.protokolle.add(p);
    await expect(performSync(async () => ({ rev: 1, changes: [], folders: [], records: [], conflicts: [], api: 0 }))).rejects.toMatchObject({ status: 426, message: expect.stringContaining('Server aktualisieren') });
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 1 });
  });

  it('ältere Server ohne Angabe gelten als Schnittstelle 1 und funktionieren weiter', async () => {
    await performSync(async () => ({ rev: 1, changes: [], folders: [], records: [], conflicts: [] }));
    expect((await db.kv.get('protokolle.rev'))?.value).toBe(1);
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
    const byId = new Map(sent!.protocols.map((c) => [c.id, c.shared]));
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

describe('Anhänge im Abgleich', () => {
  const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const withPhoto = (blobId: string) => ({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'photo', attrs: { blobId, mime: 'image/jpeg', w: 10, h: 10, caption: '' } }] });
  const photoBlob = (id: string) => putLocalBlob({ id, kind: 'photo', mime: 'image/jpeg', name: '', data: JPEG });
  const noDownload = async () => {
    throw new ProtoError('Nicht gefunden', 404);
  };

  it('lädt wartende Anhänge hoch, bevor das Protokoll gesendet wird', async () => {
    await photoBlob('foto-0001');
    const p = { ...newProtokoll(), title: 'Mit Foto', content: withPhoto('foto-0001') };
    await db.protokolle.add(p);
    const order: string[] = [];
    const transport: BlobTransport = { upload: async (meta) => void order.push(`upload ${meta.id}`), download: noDownload };
    const res = await performSync(
      async (req) => {
        order.push(`sync ${req.protocols.map((c) => c.id).join(',')}`);
        return { rev: 3, changes: [echo(p, { rev: 3 })], folders: [], conflicts: [] };
      },
      {},
      db,
      transport,
    );
    expect(order).toEqual(['upload foto-0001', `sync ${p.id}`]);
    expect(res.blobs).toEqual({ uploaded: 1, rejected: 0, failed: 0 });
    expect(await db.blobs.get('foto-0001')).toMatchObject({ state: 'synced' });
  });

  it('lässt sich ein Anhang nicht hochladen (offline), hält das die Protokolle nicht auf; der Anhang bleibt wartend', async () => {
    await photoBlob('foto-0001');
    const p = { ...newProtokoll(), title: 'Mit Foto', content: withPhoto('foto-0001') };
    await db.protokolle.add(p);
    let called = false;
    const transport: BlobTransport = { upload: async () => Promise.reject(new ProtoError('Keine Verbindung zum Server.', 0)), download: noDownload };
    const res = await performSync(
      async () => {
        called = true;
        return { rev: 2, changes: [echo(p, { rev: 2 })], folders: [], conflicts: [] };
      },
      {},
      db,
      transport,
    );
    expect(called).toBe(true);
    expect(res.blobs).toEqual({ uploaded: 0, rejected: 0, failed: 1 });
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 0 });
    expect(await db.blobs.get('foto-0001')).toMatchObject({ state: 'local' });
  });

  it('ein Server, der diese App-Version nicht kennt (426 beim Anhang), bekommt auch das Protokoll nicht', async () => {
    await photoBlob('foto-0001');
    const p = { ...newProtokoll(), title: 'Mit Foto', content: withPhoto('foto-0001') };
    await db.protokolle.add(p);
    let called = false;
    const transport: BlobTransport = { upload: async () => Promise.reject(new ProtoError('Der Server ist zu alt für diese App-Version. Bitte den Server aktualisieren.', 426)), download: noDownload };
    await expect(
      performSync(
        async () => {
          called = true;
          return { rev: 1, changes: [], folders: [], conflicts: [] };
        },
        {},
        db,
        transport,
      ),
    ).rejects.toMatchObject({ status: 426 });
    expect(called).toBe(false);
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 1 });
  });

  it('„Alles neu abgleichen“ versucht einen abgelehnten Anhang erneut', async () => {
    await photoBlob('foto-0001');
    await db.blobs.update('foto-0001', { rejected: 'Payload Too Large' }); // zum Beispiel ein Proxy mit zu kleiner Anfragegröße, inzwischen behoben
    const uploaded: string[] = [];
    const transport: BlobTransport = { upload: async (meta) => void uploaded.push(meta.id), download: noDownload };
    const answer = async () => ({ rev: 1, changes: [], folders: [], conflicts: [] });
    await performSync(answer, {}, db, transport);
    expect(uploaded).toEqual([]); // sonst käme jeder Lauf erneut gegen die Wand
    const res = await performSync(answer, { full: true }, db, transport);
    expect(uploaded).toEqual(['foto-0001']);
    expect(res.blobs.uploaded).toBe(1);
    expect(await db.blobs.get('foto-0001')).toMatchObject({ state: 'synced' });
    expect(await db.blobs.get('foto-0001')).not.toHaveProperty('rejected');
  });

  it('ein vom Server abgelehnter Anhang hält den Abgleich nicht auf und wird gemeldet', async () => {
    await photoBlob('foto-gross1');
    const p = { ...newProtokoll(), title: 'Mit Foto', content: withPhoto('foto-gross1') };
    await db.protokolle.add(p);
    const transport: BlobTransport = { upload: async () => Promise.reject(new ProtoError('Das Foto ist größer als 6 MB', 413)), download: noDownload };
    const res = await performSync(async () => ({ rev: 2, changes: [echo(p, { rev: 2 })], folders: [], conflicts: [] }), {}, db, transport);
    expect(res.blobs).toEqual({ uploaded: 0, rejected: 1, failed: 0 });
    expect(await db.blobs.get('foto-gross1')).toMatchObject({ state: 'local', rejected: 'Das Foto ist größer als 6 MB' });
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 0 });
  });

  it('ein Serverfehler bei einem Anhang hält das Protokoll nicht auf; der Anhang kommt beim nächsten Abgleich wieder dran', async () => {
    await photoBlob('foto-0001');
    const p = { ...newProtokoll(), title: 'Mit Foto', content: withPhoto('foto-0001') };
    await db.protokolle.add(p);
    const transport: BlobTransport = { upload: async () => Promise.reject(new ProtoError('Serverfehler 500.', 500)), download: noDownload };
    const res = await performSync(async () => ({ rev: 2, changes: [echo(p, { rev: 2 })], folders: [], conflicts: [] }), {}, db, transport);
    expect(res.blobs).toEqual({ uploaded: 0, rejected: 0, failed: 1 });
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 0 });
    expect(await db.blobs.get('foto-0001')).toMatchObject({ state: 'local' });
  });

  /** Ein Text mit ungesendeten Änderungen, damit der Austausch an der Reihe ist. */
  async function unsentText(id: string): Promise<void> {
    const text = new Y.Doc();
    const para = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, 'Text');
    para.insert(0, [t]);
    text.getXmlFragment('body').insert(0, [para]);
    await db.ydocs.put({ id, update: Y.encodeStateAsUpdate(text), dirty: 1, seq: 1 });
  }
  const textAnswer = (missing: string[]): ExchangeTransport => async (req) => ({ docs: req.docs.map((d) => ({ id: d.id, status: 'ok' as const, rev: 2, missingBlobs: missing })) });
  const headers = (p: Protokoll) => async () => ({ rev: 2, changes: [echo(p, { rev: 2 })], folders: [], conflicts: [] });

  it('meldet der Server beim Austausch des Textes einen Anhang als fehlend, geht er im nächsten Lauf erneut hoch', async () => {
    await photoBlob('foto-0001');
    await db.blobs.update('foto-0001', { state: 'synced' }); // einmal hochgeladen, inzwischen beim Server weg (Datenbank ersetzt)
    const p = { ...newProtokoll(), title: 'Mit Foto', dirty: 0 as const, rev: 2, content: withPhoto('foto-0001') };
    await db.protokolle.add(p);
    await unsentText(p.id);
    const uploaded: string[] = [];
    const transport: BlobTransport = { upload: async (meta) => void uploaded.push(meta.id), download: noDownload };

    const first = await performSync(headers(p), {}, db, transport, textAnswer(['foto-0001']));
    expect(first.reuploaded).toBe(1);
    expect(uploaded).toEqual([]);
    expect(await db.blobs.get('foto-0001')).toMatchObject({ state: 'local' });

    await performSync(headers(p), {}, db, transport, textAnswer([]));
    expect(uploaded).toEqual(['foto-0001']);
    expect(await db.blobs.get('foto-0001')).toMatchObject({ state: 'synced' });
  });

  it('ein Anhang, den dieses Gerät nicht hat, wird nicht angefordert', async () => {
    const p = { ...newProtokoll(), title: 'Mit Foto', dirty: 0 as const, rev: 2, content: withPhoto('foto-fremd1') };
    await db.protokolle.add(p);
    await unsentText(p.id);
    const res = await performSync(headers(p), {}, db, undefined, textAnswer(['foto-fremd1']));
    expect(res.reuploaded).toBe(0);
  });

  it('ohne wartende Anhänge entsteht keine Anfrage an die Anhang-Schnittstelle', async () => {
    let touched = false;
    const transport: BlobTransport = {
      upload: async () => void (touched = true),
      download: async () => {
        touched = true;
        return new Uint8Array();
      },
    };
    await performSync(async () => ({ rev: 1, changes: [], folders: [], conflicts: [] }), {}, db, transport);
    expect(touched).toBe(false);
  });
});

describe('performSync: der Text', () => {
  const textOf = (text: string): Uint8Array => {
    const d = new Y.Doc();
    const para = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, text);
    para.insert(0, [t]);
    d.getXmlFragment('body').insert(0, [para]);
    return Y.encodeStateAsUpdate(d);
  };
  const ok: ExchangeTransport = async (req) => ({ docs: req.docs.map((d) => ({ id: d.id, status: 'ok' as const, rev: 9 })) });

  it('Protokolle aus der Zeit vor 3.0.0, die der Server nie bekommen hat, bekommen ihre Basis vor dem ersten Senden', async () => {
    const p = { ...newProtokoll(), title: 'Alt', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Aus 2.3.0' }] }] } };
    await db.protokolle.add(p);
    let basisBeimSenden: unknown;
    await performSync(async (req) => {
      basisBeimSenden = await db.ydocs.get(req.protocols[0]!.id);
      return { rev: 3, changes: [echo(p, { rev: 3 })], folders: [], conflicts: [] };
    });
    expect(basisBeimSenden).toMatchObject({ dirty: 1, created: true });
  });

  it('nach den Kopfdaten läuft der Austausch des Textes; sein Ergebnis steht im Ergebnis des Abgleichs', async () => {
    const p = { ...newProtokoll(), dirty: 0 as const, rev: 2, textRev: 2 };
    await db.protokolle.add(p);
    await db.ydocs.put({ id: p.id, update: textOf('lokal'), dirty: 1, seq: 1 });
    const res = await performSync(async () => ({ rev: 3, changes: [echo(p, { rev: 3 })], folders: [], conflicts: [] }), {}, db, undefined, ok);
    expect(res.text).toMatchObject({ exchanged: 1, sent: 1 });
    expect(res.pushed).toBe(1);
    expect(await db.ydocs.get(p.id)).toMatchObject({ dirty: 0 });
    expect((await db.protokolle.get(p.id))!.textRev).toBe(9);
  });

  it('ist der Server für den Text nicht erreichbar, bleibt der Abgleich der Kopfdaten gültig; andere Fehler brechen ab', async () => {
    const p = { ...newProtokoll(), title: 'A' };
    await db.protokolle.add(p);
    const res = await performSync(async () => ({ rev: 3, changes: [echo(p, { rev: 3 })], folders: [], conflicts: [] }));
    expect(res.text).toBeNull();
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 0, rev: 3 });

    const q = { ...newProtokoll(), dirty: 0 as const, rev: 2 };
    await db.protokolle.add(q);
    await db.ydocs.put({ id: q.id, update: textOf('x'), dirty: 1, seq: 1 });
    await db.kv.put({ key: 'protokolle.serverRecords', value: true });
    await expect(
      performSync(async () => ({ rev: 4, changes: [], folders: [], records: [], conflicts: [] }), {}, db, undefined, async () => Promise.reject(new ProtoError('Der Server ist zu alt für diese App-Version. Bitte den Server aktualisieren.', 426))),
    ).rejects.toMatchObject({ status: 426 });
  });

  describe('neue Datenbank beim Server (wiederhergestellt oder ersetzt)', () => {
    async function setup() {
      await db.kv.bulkPut([
        { key: 'protokolle.rev', value: 50 },
        { key: 'protokolle.epoch', value: 'alt' },
        { key: 'protokolle.serverRecords', value: true },
      ]);
      const unsent = { ...newProtokoll('', true), title: 'Mit Ungesendetem', dirty: 0 as const, rev: 40, textRev: 40 };
      const clean = { ...newProtokoll('', true), title: 'Sauber', dirty: 0 as const, rev: 41, textRev: 41 };
      const unknown = { ...newProtokoll(), title: 'Dem Server unbekannt', dirty: 0 as const, rev: 42, textRev: 42 };
      await db.protokolle.bulkAdd([unsent, clean, unknown]);
      await db.ydocs.bulkPut([
        { id: unsent.id, update: textOf('Anna schrieb das'), dirty: 1, seq: 3, serverSv: new Uint8Array([0]) },
        { id: clean.id, update: textOf('alter Stand'), dirty: 0, seq: 0, serverSv: new Uint8Array([0]) },
        { id: unknown.id, update: textOf('nur hier'), dirty: 0, seq: 0, serverSv: new Uint8Array([0]) },
      ]);
      return { unsent, clean, unknown };
    }
    const reset = (docs: ServerDoc[]) => async () => ({ rev: 3, epoch: 'neu', reset: true, changes: docs, folders: [], records: [], conflicts: [] });

    it('verwirft den gemerkten Text der Protokolle, die der Server kennt, damit die Wiederherstellung nicht rückgängig gemacht wird', async () => {
      const { unsent, clean } = await setup();
      await performSync(reset([echo(unsent, { rev: 2 }), echo(clean, { rev: 2 })]));
      expect(await db.ydocs.get(clean.id)).toBeUndefined();
      expect(await db.ydocs.get(unsent.id)).toBeUndefined();
      expect((await db.protokolle.get(clean.id))!.textRev).toBeUndefined();
    });

    it('was dort ungesendet war, bleibt als private Kopie erhalten', async () => {
      const { unsent } = await setup();
      await performSync(reset([echo(unsent, { rev: 2 })]));
      const copies = await db.protokolle.filter((p) => p.title.endsWith('(lokale Fassung)')).toArray();
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({ title: 'Mit Ungesendetem (lokale Fassung)', rev: 0, dirty: 1, shared: false });
      expect(await db.ydocs.get(copies[0]!.id)).toMatchObject({ dirty: 1 });
    });

    it('Protokolle, die der Server nicht kennt, gehen mit ihrem ganzen Text als neu hoch', async () => {
      const { unsent, unknown } = await setup();
      await performSync(reset([echo(unsent, { rev: 2 })]));
      expect(await db.protokolle.get(unknown.id)).toMatchObject({ rev: 0, dirty: 1 });
      expect(await db.protokolle.get(unknown.id).then((p) => p?.textRev)).toBeUndefined();
      expect(await db.ydocs.get(unknown.id)).toMatchObject({ dirty: 1, serverSv: undefined });
    });

    it('„Alles neu abgleichen“ ohne neue Datenbank behält die Texte', async () => {
      const { clean } = await setup();
      await performSync(async () => ({ rev: 50, changes: [echo(clean, { rev: 41 })], folders: [], records: [], conflicts: [] }), { full: true });
      expect(await db.ydocs.get(clean.id)).toBeDefined();
    });
  });
});
