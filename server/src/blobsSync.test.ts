import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { MAX_PHOTO_BYTES, reindexBlobRefs, storeBlob, sweepBlobs } from './blobs.js';
import { openDb } from './db.js';
import { applySync, purgeProtocol, type ClientChange, type SyncResponse } from './sync.js';

const DAY = 86_400_000;
const USER = { id: 'u1', role: 'betreuer' as const };
const OTHER = { id: 'u2', role: 'betreuer' as const };
let db: DatabaseSync;

beforeEach(() => {
  db = openDb(':memory:');
});

const jpeg = (size = 64): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(size), Buffer.from([0xff, 0xd9])]);
const dataUrl = (b: Buffer) => `data:image/jpeg;base64,${b.toString('base64')}`;

interface Node {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
}
const p = (text: string): Node => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const photoInline = (b: Buffer, attrs: Record<string, unknown> = {}): Node => ({ type: 'photo', attrs: { src: dataUrl(b), w: 800, h: 600, caption: '', ...attrs } });
const photoRef = (blobId: string, attrs: Record<string, unknown> = {}): Node => ({ type: 'photo', attrs: { blobId, mime: 'image/jpeg', w: 800, h: 600, caption: '', ...attrs } });
const fileInline = (b: Buffer, attrs: Record<string, unknown> = {}): Node => ({ type: 'attachment', attrs: { name: 'Plan.pdf', mime: 'application/pdf', size: b.length, data: b.toString('base64'), ...attrs } });
const doc = (...content: Node[]) => ({ type: 'doc', content });

const change = (id: string, content: unknown, over: Partial<ClientChange> = {}): ClientChange => ({
  id,
  baseRev: 0,
  title: 'Sitzung',
  datum: '2026-10-01',
  beginn: '',
  ende: '',
  ort: '',
  leitung: '',
  content,
  updatedAt: Date.now(),
  deleted: false,
  ...over,
});

const send = (changes: ClientChange[], since = 0, user = USER): SyncResponse => applySync(db, { since, changes }, user);
const nodesOf = (res: SyncResponse, id: string): Node[] => (res.changes.find((c) => c.id === id)!.content as Node).content ?? [];
const refs = () => db.prepare('SELECT blobId, protocolId FROM blob_refs ORDER BY protocolId, blobId').all();
const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const upload = (id: string, over: { now?: number; uploaderId?: string } = {}) =>
  storeBlob(db, { id, kind: 'photo', name: '', mime: 'image/jpeg', data: jpeg(), uploaderId: over.uploaderId ?? 'u1', ...(over.now === undefined ? {} : { now: over.now }) });

describe('Anhänge beim Speichern auslagern', () => {
  it('Fotos als Data-URL werden zu Blobs, das Protokoll schrumpft', () => {
    const a = jpeg(2000);
    const b = jpeg(3000);
    const res = send([change('doc-0001', doc(p('Text'), photoInline(a, { caption: 'Teich' }), photoInline(b)))]);
    expect(res.rejected).toEqual([]);

    const photos = nodesOf(res, 'doc-0001').filter((n) => n.type === 'photo');
    expect(photos).toHaveLength(2);
    for (const ph of photos) {
      expect(ph.attrs).not.toHaveProperty('src');
      expect(ph.attrs).toMatchObject({ mime: 'image/jpeg', w: 800, h: 600 });
      expect(String(ph.attrs!.blobId)).toMatch(/^p-[0-9a-f]{40}$/);
    }
    expect(photos[0]!.attrs).toMatchObject({ caption: 'Teich' });

    expect(db.prepare('SELECT id, kind, size, mime, uploaderId FROM blobs ORDER BY size').all()).toEqual([
      { id: photos[0]!.attrs!.blobId, kind: 'photo', size: a.length, mime: 'image/jpeg', uploaderId: 'u1' },
      { id: photos[1]!.attrs!.blobId, kind: 'photo', size: b.length, mime: 'image/jpeg', uploaderId: 'u1' },
    ]);
    expect(refs()).toHaveLength(2);
    expect(JSON.stringify(res.changes[0]!.content).length).toBeLessThan(1000);
    expect((db.prepare('SELECT length(content) AS n FROM protocols WHERE id = ?').get('doc-0001') as { n: number }).n).toBeLessThan(1000);
  });

  it('dasselbe Foto in mehreren Protokollen ist ein einziger Blob', () => {
    const a = jpeg(1500);
    send([change('doc-0001', doc(photoInline(a))), change('doc-0002', doc(p('anderes'), photoInline(a)))]);
    expect(count('blobs')).toBe(1);
    expect(refs()).toHaveLength(2);
  });

  it('Dateianhänge werden zu Blobs, Name, Typ und Größe bleiben im Protokoll', () => {
    const f = randomBytes(5000);
    const res = send([change('doc-0001', doc(fileInline(f)))]);
    const att = nodesOf(res, 'doc-0001')[0]!;
    expect(att.attrs).toEqual({ name: 'Plan.pdf', mime: 'application/pdf', size: 5000, blobId: expect.stringMatching(/^f-[0-9a-f]{40}$/) });
    expect(db.prepare('SELECT kind, name, mime, size FROM blobs').all()).toEqual([{ kind: 'file', name: 'Plan.pdf', mime: 'application/pdf', size: 5000 }]);
  });

  it('lehnt Unbrauchbares einzeln ab: kein JPEG, kein Base64, zu groß; die übrigen Änderungen gelten', () => {
    const good = change('gut-00001', doc(p('ok')));
    const png = change('png-0001', doc({ type: 'photo', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', w: 1, h: 1, caption: '' } }));
    const fake = change('fake-001', doc(photoInline(Buffer.from('kein jpeg'))));
    const bad64 = change('b64-0001', doc({ type: 'attachment', attrs: { name: 'x', mime: 'a/b', size: 1, data: '***' } }));
    const huge = change('gross-001', doc(photoInline(Buffer.concat([jpeg(), Buffer.alloc(MAX_PHOTO_BYTES)]))));
    const res = send([good, png, fake, bad64, huge]);
    expect(res.rejected.map((r) => r.id).sort()).toEqual(['b64-0001', 'fake-001', 'gross-001', 'png-0001']);
    expect(res.rejected.find((r) => r.id === 'png-0001')!.reason).toContain('JPEG');
    expect(res.rejected.find((r) => r.id === 'gross-001')!.reason).toContain('größer');
    expect(res.changes.map((c) => c.id)).toEqual(['gut-00001']);
    expect(count('blobs')).toBe(0);
    expect(count('blob_refs')).toBe(0);
  });

  it('der Hochladende ist, wer die Daten schickt (auch bei fremden, veröffentlichten Protokollen)', () => {
    const first = send([change('doc-0001', doc(p('Start')), { shared: true })]);
    send([change('doc-0001', doc(p('Start'), photoInline(jpeg())), { baseRev: first.changes[0]!.rev })], first.rev, OTHER);
    expect(db.prepare('SELECT uploaderId FROM blobs').all()).toEqual([{ uploaderId: 'u2' }]);
  });

  it('eine Wiederholung nach verlorener Antwort ist kein Konflikt, auch wenn die Daten noch im Protokoll stecken', () => {
    const c = change('doc-0001', doc(p('Text'), photoInline(jpeg(800))));
    const first = send([c]);
    expect(first.conflicts).toEqual([]);
    const retry = send([c]); // dieselbe Anfrage noch einmal (Basisrevision 0)
    expect(retry.conflicts).toEqual([]);
    expect(count('protocols')).toBe(1);
    expect(retry.changes.map((x) => x.id)).toEqual(['doc-0001']); // das Gerät bekommt seine Fassung zurück
  });

  it('Verweise folgen dem Inhalt; der Blob selbst bleibt bis zur Müllsammlung', () => {
    const first = send([change('doc-0001', doc(photoInline(jpeg()), photoInline(jpeg())))]);
    const [one, two] = nodesOf(first, 'doc-0001').map((n) => String(n.attrs!.blobId));
    expect(refs()).toHaveLength(2);
    const edit = send([change('doc-0001', doc(p('nur eines'), photoRef(one!)), { baseRev: first.changes[0]!.rev })], first.rev);
    expect(edit.rejected).toEqual([]);
    expect(refs()).toEqual([{ blobId: one, protocolId: 'doc-0001' }]);
    expect(db.prepare('SELECT id FROM blobs WHERE id = ?').get(two!)).toBeDefined();
  });

  it('meldet Blobs, auf die ein soeben gespeichertes Protokoll verweist, die der Server aber nicht hat', () => {
    const c = change('doc-0001', doc(photoRef('foto-0001')));
    const first = send([c]);
    expect(first.rejected).toEqual([]);
    expect(first.missingBlobs).toEqual(['foto-0001']);
    expect(send([], first.rev).missingBlobs).toEqual([]); // nur, was in dieser Anfrage geschrieben wurde

    upload('foto-0001');
    const edit = send([change('doc-0001', doc(photoRef('foto-0001')), { baseRev: first.changes[0]!.rev, title: 'Neu' })], first.rev);
    expect(edit.missingBlobs).toEqual([]);
  });

  it('gelöschte Protokolle behalten ihre Verweise (wiederherstellbar), das endgültige Leeren entfernt sie', () => {
    const first = send([change('doc-0001', doc(photoInline(jpeg())))]);
    send([change('doc-0001', doc(), { baseRev: first.changes[0]!.rev, deleted: true })], first.rev);
    expect(refs()).toHaveLength(1);
    expect(purgeProtocol(db, 'doc-0001')).toBe(true);
    expect(refs()).toHaveLength(0);
  });

  it('wiederholtes Speichern desselben Inhalts ändert weder Blobs noch Verweise', () => {
    const c = change('doc-0001', doc(photoInline(jpeg(300))));
    const first = send([c]);
    const stored = nodesOf(first, 'doc-0001');
    send([change('doc-0001', { type: 'doc', content: stored }, { baseRev: first.changes[0]!.rev, title: 'Titel geändert' })], first.rev);
    expect(count('blobs')).toBe(1);
    expect(refs()).toHaveLength(1);
  });
});

describe('Müllsammlung für Blobs', () => {
  it('entfernt Blobs erst, wenn seit sieben Tagen nichts mehr auf sie verweist; nie solche mit Verweis', () => {
    const t0 = Date.now();
    upload('alt-ohne-1', { now: t0 });
    upload('alt-mit-01', { now: t0 });
    send([change('doc-0001', doc(photoRef('alt-mit-01')))]);

    expect(sweepBlobs(db, t0 + 1 * DAY)).toBe(0); // merkt sich, dass alt-ohne-1 ohne Verweis dasteht
    expect(sweepBlobs(db, t0 + 7 * DAY)).toBe(0); // erst sechs Tage
    expect(sweepBlobs(db, t0 + 8 * DAY + 1000)).toBe(1);
    expect((db.prepare('SELECT id FROM blobs').all() as { id: string }[]).map((r) => r.id)).toEqual(['alt-mit-01']);
    expect(sweepBlobs(db, t0 + 100 * DAY)).toBe(0); // der mit Verweis bleibt
  });

  it('ein Foto, das erst jetzt seinen letzten Verweis verliert, bleibt noch sieben Tage, auch wenn es uralt ist', () => {
    const t0 = Date.now();
    upload('foto-0001', { now: t0 - 270 * DAY });
    const first = send([change('doc-0001', doc(photoRef('foto-0001')))]);
    expect(sweepBlobs(db, t0)).toBe(0);
    // Ein anderes Gerät entfernt das Foto aus dem Text.
    send([change('doc-0001', doc(p('ohne Foto')), { baseRev: first.changes[0]!.rev })], first.rev);
    expect(sweepBlobs(db, t0 + 1 * DAY)).toBe(0);
    expect(sweepBlobs(db, t0 + 7 * DAY)).toBe(0);
    expect(count('blobs')).toBe(1); // ein Gerät, das lange offline war, kann noch darauf verweisen
    expect(sweepBlobs(db, t0 + 9 * DAY)).toBe(1);
  });

  it('ein neuer Verweis hebt die Markierung auf', () => {
    const t0 = Date.now();
    upload('foto-0001', { now: t0 });
    expect(sweepBlobs(db, t0 + 1 * DAY)).toBe(0); // ohne Verweis markiert
    send([change('doc-0001', doc(photoRef('foto-0001')))]);
    expect(sweepBlobs(db, t0 + 10 * DAY)).toBe(0); // inzwischen gebraucht
    expect((db.prepare('SELECT orphanedAt FROM blobs').get() as { orphanedAt: number | null }).orphanedAt).toBeNull();
  });

  it('ein erneutes Hochladen verlängert die Frist', () => {
    const t0 = Date.now();
    const bytes = jpeg();
    storeBlob(db, { id: 'foto-0001', kind: 'photo', name: '', mime: 'image/jpeg', data: bytes, uploaderId: 'u1', now: t0 });
    expect(sweepBlobs(db, t0 + 1 * DAY)).toBe(0);
    storeBlob(db, { id: 'foto-0001', kind: 'photo', name: '', mime: 'image/jpeg', data: bytes, uploaderId: 'u1', now: t0 + 6 * DAY });
    expect(sweepBlobs(db, t0 + 8 * DAY)).toBe(0); // markiert den Blob von Neuem
    expect(sweepBlobs(db, t0 + 14 * DAY)).toBe(0);
    expect(sweepBlobs(db, t0 + 16 * DAY)).toBe(1);
  });

  it('nach dem endgültigen Leeren eines Protokolls werden seine Blobs nach einer Woche frei', () => {
    const t0 = Date.now();
    const first = send([change('doc-0001', doc(photoInline(jpeg())))]);
    send([change('doc-0001', doc(), { baseRev: first.changes[0]!.rev, deleted: true })], first.rev);
    expect(sweepBlobs(db, t0 + 30 * DAY)).toBe(0); // liegt noch im Papierkorb
    purgeProtocol(db, 'doc-0001');
    expect(sweepBlobs(db, t0 + 31 * DAY)).toBe(0); // merkt es sich
    expect(sweepBlobs(db, t0 + 39 * DAY)).toBe(1);
    expect(count('blobs')).toBe(0);
  });
});

describe('Altbestand und Namen', () => {
  const legacyRow = (id: string, content: unknown) =>
    db
      .prepare(
        `INSERT INTO protocols(id, title, folderId, datum, beginn, ende, ort, leitung, content, ownerId, shared, hiddenRev, rev, updatedAt, deletedAt)
         VALUES(?, 'Alt', '', '2026-01-01', '', '', '', '', ?, 'u1', 1, NULL, 1, 1234, NULL)`,
      )
      .run(id, JSON.stringify(content));

  it('ein Protokoll, dessen Altinhalt sich nicht auslagern ließ, lässt sich trotzdem löschen und zurückholen', () => {
    // Ein Foto, das kein JPEG ist: so etwas erzeugt die App nicht, per Schnittstelle ginge es aber.
    legacyRow('alt-000001', doc({ type: 'photo', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', w: 1, h: 1, caption: '' } }));
    const del = send([change('alt-000001', doc(), { baseRev: 1, deleted: true })]);
    expect(del.rejected).toEqual([]);
    expect(del.changes.find((c) => c.id === 'alt-000001')).toMatchObject({ deleted: true });
    expect((db.prepare('SELECT deletedAt FROM protocols WHERE id = ?').get('alt-000001') as { deletedAt: number | null }).deletedAt).not.toBeNull();
  });

  it('Neues mit einem unbrauchbaren Foto wird weiterhin abgelehnt', () => {
    const res = send([change('neu-000001', doc({ type: 'photo', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', w: 1, h: 1, caption: '' } }))]);
    expect(res.rejected.map((r) => r.id)).toEqual(['neu-000001']);
  });

  it('der Name im Protokoll bleibt erhalten, auch ein sehr langer samt Endung', () => {
    const long = `${'Bericht '.repeat(30)}Jahr.pdf`; // über 200 Zeichen
    const res = send([change('doc-0001', doc(fileInline(randomBytes(300), { name: long })))]);
    const shown = String(nodesOf(res, 'doc-0001')[0]!.attrs!.name);
    expect(shown.endsWith('Jahr.pdf')).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(255);
    const row = db.prepare('SELECT name FROM blobs').get() as { name: string };
    expect(row.name.endsWith('.pdf')).toBe(true);
    expect(row.name.length).toBeLessThanOrEqual(120);
  });
});

describe('Verweise prüfen und bei Bedarf neu aufbauen', () => {
  it('ergänzt fehlende und entfernt überzählige Verweise nach dem Inhalt', () => {
    const res = send([change('doc-0001', doc(photoInline(jpeg()))), change('doc-0002', doc(p('ohne Anhang')))]);
    const id = String(nodesOf(res, 'doc-0001')[0]!.attrs!.blobId);
    db.prepare('DELETE FROM blob_refs').run(); // verloren gegangen
    db.prepare("INSERT INTO blob_refs(blobId, protocolId) VALUES('fremd-0001', 'doc-0002')").run(); // überzählig

    expect(reindexBlobRefs(db)).toBe(2);
    expect(refs()).toEqual([{ blobId: id, protocolId: 'doc-0001' }]);
    expect(reindexBlobRefs(db)).toBe(0); // jetzt stimmt alles, nichts ist zu tun
  });

  it('schützt dadurch Anhänge vor der Müllsammlung, auf die der Inhalt noch verweist', () => {
    const t0 = Date.now();
    const res = send([change('doc-0001', doc(photoInline(jpeg())))]);
    db.prepare('DELETE FROM blob_refs').run();
    reindexBlobRefs(db);
    expect(sweepBlobs(db, t0 + 30 * DAY)).toBe(0);
    expect(count('blobs')).toBe(1);
    expect(res.rejected).toEqual([]);
  });

  it('geleerte Protokolle verweisen auf nichts; unlesbarer Inhalt lässt vorhandene Verweise stehen', () => {
    const first = send([change('doc-0001', doc(photoInline(jpeg()))), change('doc-0002', doc(photoInline(jpeg())))]);
    send([change('doc-0001', doc(), { baseRev: first.changes.find((c) => c.id === 'doc-0001')!.rev, deleted: true })], first.rev);
    purgeProtocol(db, 'doc-0001');
    db.prepare("INSERT INTO blob_refs(blobId, protocolId) VALUES('spuk-000001', 'doc-0001')").run();
    db.prepare("UPDATE protocols SET content = '{kaputt' WHERE id = 'doc-0002'").run();
    expect(reindexBlobRefs(db)).toBe(1);
    expect(refs().map((r) => (r as { protocolId: string }).protocolId)).toEqual(['doc-0002']);
  });
});
