import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { BlobError, MAX_PHOTO_BYTES, normalizeContent, refreshRefs, reindexBlobRefs, saveBlobs, storeBlob, sweepBlobs } from './blobs.js';
import type { DocNode } from './collab/convert.js';
import { putProtocol, type PutOptions } from './collab/testing.js';
import { openDb } from './db.js';
import { applySync, purgeProtocol, type ClientChange } from './sync.js';

const DAY = 86_400_000;
const USER = { id: 'u1', role: 'betreuer' as const };
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

/** Ein Protokoll mit diesem Inhalt, wie der Server es seit 3.0.0 hält (Text als Yjs-Dokument, Verweise abgeleitet). */
const put = (id: string, content: Node, over: Omit<PutOptions, 'id' | 'content'> = {}) => putProtocol(db, { id, ownerId: USER.id, content: content as DocNode, ...over });
const refs = () => db.prepare('SELECT blobId, protocolId FROM blob_refs ORDER BY protocolId, blobId').all();
const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const upload = (id: string, over: { now?: number; uploaderId?: string } = {}) =>
  storeBlob(db, { id, kind: 'photo', name: '', mime: 'image/jpeg', data: jpeg(), uploaderId: over.uploaderId ?? 'u1', ...(over.now === undefined ? {} : { now: over.now }) });
const nodesOf = (content: unknown): Node[] => (content as Node).content ?? [];

describe('Anhänge aus altem Inhalt auslagern (Umstellung von Sicherungen vor 2.2.0)', () => {
  it('Fotos als Data-URL werden zu Blobs, das Protokoll schrumpft', () => {
    const a = jpeg(2000);
    const b = jpeg(3000);
    const normalized = normalizeContent(doc(p('Text'), photoInline(a, { caption: 'Teich' }), photoInline(b)), true);
    const photos = nodesOf(normalized.content).filter((n) => n.type === 'photo');
    expect(photos).toHaveLength(2);
    for (const ph of photos) {
      expect(ph.attrs).not.toHaveProperty('src');
      expect(ph.attrs).toMatchObject({ mime: 'image/jpeg', w: 800, h: 600 });
      expect(String(ph.attrs!.blobId)).toMatch(/^p-[0-9a-f]{40}$/);
    }
    expect(photos[0]!.attrs).toMatchObject({ caption: 'Teich' });
    expect(saveBlobs(db, normalized.blobs, 'u1')).toBe(2);
    expect(db.prepare('SELECT id, kind, size, mime, uploaderId FROM blobs ORDER BY size').all()).toEqual([
      { id: photos[0]!.attrs!.blobId, kind: 'photo', size: a.length, mime: 'image/jpeg', uploaderId: 'u1' },
      { id: photos[1]!.attrs!.blobId, kind: 'photo', size: b.length, mime: 'image/jpeg', uploaderId: 'u1' },
    ]);
    expect(JSON.stringify(normalized.content).length).toBeLessThan(1000);
  });

  it('dasselbe Foto in mehreren Protokollen ist ein einziger Blob', () => {
    const a = jpeg(1500);
    saveBlobs(db, normalizeContent(doc(photoInline(a)), true).blobs, 'u1');
    saveBlobs(db, normalizeContent(doc(p('anderes'), photoInline(a)), true).blobs, 'u1');
    expect(count('blobs')).toBe(1);
  });

  it('Dateianhänge werden zu Blobs, Name, Typ und Größe bleiben im Protokoll', () => {
    const f = randomBytes(5000);
    const normalized = normalizeContent(doc(fileInline(f)), true);
    expect(nodesOf(normalized.content)[0]!.attrs).toEqual({ name: 'Plan.pdf', mime: 'application/pdf', size: 5000, blobId: expect.stringMatching(/^f-[0-9a-f]{40}$/) });
    saveBlobs(db, normalized.blobs, 'u1');
    expect(db.prepare('SELECT kind, name, mime, size FROM blobs').all()).toEqual([{ kind: 'file', name: 'Plan.pdf', mime: 'application/pdf', size: 5000 }]);
  });

  it('streng abgelehnt wird Unbrauchbares: kein JPEG, kein Base64, zu groß; ohne `strict` bleibt Unbrauchbares stehen und wird gezählt, Großes wird übernommen', () => {
    const bad: [string, Node, string][] = [
      ['png', { type: 'photo', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', w: 1, h: 1, caption: '' } }, 'JPEG'],
      ['kein JPEG', photoInline(Buffer.from('kein jpeg')), 'JPEG'],
      ['kein Base64', { type: 'attachment', attrs: { name: 'x', mime: 'a/b', size: 1, data: '***' } }, 'Base64'],
    ];
    for (const [name, node, message] of bad) {
      expect(() => normalizeContent(doc(node), true), name).toThrow(BlobError);
      expect(() => normalizeContent(doc(node), true), name).toThrow(message);
      const lenient = normalizeContent(doc(p('Text'), node), false);
      expect(lenient.skipped, name).toBe(1);
      expect(lenient.blobs, name).toHaveLength(0);
    }
    // Zu große Fotos lehnt nur die strenge Prüfung ab; alter Bestand soll sich trotzdem umstellen lassen.
    const huge = photoInline(Buffer.concat([jpeg(), Buffer.alloc(MAX_PHOTO_BYTES)]));
    expect(() => normalizeContent(doc(huge), true)).toThrow('größer');
    const lenient = normalizeContent(doc(huge), false);
    expect(lenient.skipped).toBe(0);
    expect(lenient.blobs).toHaveLength(1);
  });

  it('der Hochladende ist, wer die Daten schickt', () => {
    saveBlobs(db, normalizeContent(doc(photoInline(jpeg())), true).blobs, 'u2');
    expect(db.prepare('SELECT uploaderId FROM blobs').all()).toEqual([{ uploaderId: 'u2' }]);
  });

  it('der Name im Protokoll bleibt erhalten, auch ein sehr langer samt Endung', () => {
    const long = `${'Bericht '.repeat(30)}Jahr.pdf`; // über 200 Zeichen
    const normalized = normalizeContent(doc(fileInline(randomBytes(300), { name: long })), true);
    const shown = String(nodesOf(normalized.content)[0]!.attrs!.name);
    expect(shown.endsWith('Jahr.pdf')).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(255);
    saveBlobs(db, normalized.blobs, 'u1');
    const row = db.prepare('SELECT name FROM blobs').get() as { name: string };
    expect(row.name.endsWith('.pdf')).toBe(true);
    expect(row.name.length).toBeLessThanOrEqual(120);
  });
});

describe('Verweise auf Anhänge', () => {
  it('folgen dem Inhalt; der Blob selbst bleibt bis zur Müllsammlung', () => {
    upload('foto-0001');
    upload('foto-0002');
    put('doc-0001', doc(photoRef('foto-0001'), photoRef('foto-0002')));
    expect(refs()).toHaveLength(2);
    refreshRefs(db, 'doc-0001', doc(p('nur eines'), photoRef('foto-0001')));
    expect(refs()).toEqual([{ blobId: 'foto-0001', protocolId: 'doc-0001' }]);
    expect(db.prepare('SELECT id FROM blobs WHERE id = ?').get('foto-0002')).toBeDefined();
  });

  it('gelöschte Protokolle behalten ihre Verweise (wiederherstellbar), das endgültige Leeren entfernt sie', () => {
    put('doc-0001', doc(photoRef('foto-0001')), { deleted: true });
    expect(refs()).toHaveLength(1);
    expect(purgeProtocol(db, 'doc-0001')).toBe(true);
    expect(refs()).toHaveLength(0);
  });
});

describe('Müllsammlung für Blobs', () => {
  it('entfernt Blobs erst, wenn seit sieben Tagen nichts mehr auf sie verweist; nie solche mit Verweis', () => {
    const t0 = Date.now();
    upload('alt-ohne-1', { now: t0 });
    upload('alt-mit-01', { now: t0 });
    put('doc-0001', doc(photoRef('alt-mit-01')));

    expect(sweepBlobs(db, t0 + 1 * DAY)).toBe(0); // merkt sich, dass alt-ohne-1 ohne Verweis dasteht
    expect(sweepBlobs(db, t0 + 7 * DAY)).toBe(0); // erst sechs Tage
    expect(sweepBlobs(db, t0 + 8 * DAY + 1000)).toBe(1);
    expect((db.prepare('SELECT id FROM blobs').all() as { id: string }[]).map((r) => r.id)).toEqual(['alt-mit-01']);
    expect(sweepBlobs(db, t0 + 100 * DAY)).toBe(0); // der mit Verweis bleibt
  });

  it('ein Foto, das erst jetzt seinen letzten Verweis verliert, bleibt noch sieben Tage, auch wenn es uralt ist', () => {
    const t0 = Date.now();
    upload('foto-0001', { now: t0 - 270 * DAY });
    put('doc-0001', doc(photoRef('foto-0001')));
    expect(sweepBlobs(db, t0)).toBe(0);
    // Ein anderes Gerät entfernt das Foto aus dem Text.
    refreshRefs(db, 'doc-0001', doc(p('ohne Foto')));
    expect(sweepBlobs(db, t0 + 1 * DAY)).toBe(0);
    expect(sweepBlobs(db, t0 + 7 * DAY)).toBe(0);
    expect(count('blobs')).toBe(1); // ein Gerät, das lange offline war, kann noch darauf verweisen
    expect(sweepBlobs(db, t0 + 9 * DAY)).toBe(1);
  });

  it('ein neuer Verweis hebt die Markierung auf', () => {
    const t0 = Date.now();
    upload('foto-0001', { now: t0 });
    expect(sweepBlobs(db, t0 + 1 * DAY)).toBe(0); // ohne Verweis markiert
    put('doc-0001', doc(photoRef('foto-0001')));
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
    upload('foto-0001', { now: t0 });
    put('doc-0001', doc(photoRef('foto-0001')), { deleted: true });
    expect(sweepBlobs(db, t0 + 30 * DAY)).toBe(0); // liegt noch im Papierkorb
    purgeProtocol(db, 'doc-0001');
    expect(sweepBlobs(db, t0 + 31 * DAY)).toBe(0); // merkt es sich
    expect(sweepBlobs(db, t0 + 39 * DAY)).toBe(1);
    expect(count('blobs')).toBe(0);
  });
});

describe('Altbestand', () => {
  it('ein Protokoll, dessen Altinhalt sich nicht auslagern ließ, lässt sich trotzdem löschen und zurückholen', () => {
    // Ein Foto, das kein JPEG ist: so etwas erzeugt die App nicht, per Schnittstelle ginge es aber.
    put('alt-000001', doc({ type: 'photo', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', w: 1, h: 1, caption: '' } }), { ymode: 0 });
    const change: ClientChange = { id: 'alt-000001', baseRev: 1, title: '', datum: '', beginn: '', ende: '', ort: '', leitung: '', updatedAt: Date.now(), deleted: true };
    const del = applySync(db, { since: 0, protocols: [change] }, USER);
    expect(del.rejected).toEqual([]);
    expect(del.changes.find((c) => c.id === 'alt-000001')).toMatchObject({ deleted: true });
    expect((db.prepare('SELECT deletedAt FROM protocols WHERE id = ?').get('alt-000001') as { deletedAt: number | null }).deletedAt).not.toBeNull();
  });
});

describe('Verweise prüfen und bei Bedarf neu aufbauen', () => {
  it('ergänzt fehlende und entfernt überzählige Verweise nach dem Inhalt', () => {
    put('doc-0001', doc(photoRef('foto-0001')));
    put('doc-0002', doc(p('ohne Anhang')));
    db.prepare('DELETE FROM blob_refs').run(); // verloren gegangen
    db.prepare("INSERT INTO blob_refs(blobId, protocolId) VALUES('fremd-0001', 'doc-0002')").run(); // überzählig

    expect(reindexBlobRefs(db)).toBe(2);
    expect(refs()).toEqual([{ blobId: 'foto-0001', protocolId: 'doc-0001' }]);
    expect(reindexBlobRefs(db)).toBe(0); // jetzt stimmt alles, nichts ist zu tun
  });

  it('schützt dadurch Anhänge vor der Müllsammlung, auf die der Inhalt noch verweist', () => {
    const t0 = Date.now();
    upload('foto-0001', { now: t0 });
    put('doc-0001', doc(photoRef('foto-0001')));
    db.prepare('DELETE FROM blob_refs').run();
    reindexBlobRefs(db);
    expect(sweepBlobs(db, t0 + 30 * DAY)).toBe(0);
    expect(count('blobs')).toBe(1);
  });

  it('geleerte Protokolle verweisen auf nichts; unlesbarer Inhalt lässt vorhandene Verweise stehen', () => {
    put('doc-0001', doc(photoRef('foto-0001')), { deleted: true });
    put('doc-0002', doc(photoRef('foto-0002')));
    purgeProtocol(db, 'doc-0001');
    db.prepare("INSERT INTO blob_refs(blobId, protocolId) VALUES('spuk-000001', 'doc-0001')").run();
    db.prepare("UPDATE protocols SET content = '{kaputt' WHERE id = 'doc-0002'").run();
    expect(reindexBlobRefs(db)).toBe(1);
    expect(refs().map((r) => (r as { protocolId: string }).protocolId)).toEqual(['doc-0002']);
  });
});
