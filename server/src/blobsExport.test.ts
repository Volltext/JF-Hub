import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from './app.js';
import { openDb } from './db.js';
import { resetDemo } from './demo.js';
import { buildDocDefinition, type PdfStyle } from './pdf.js';
import { storeBlob } from './blobs.js';
import type { DocNode } from './collab/convert.js';
import { headerChange, putProtocol } from './collab/testing.js';
import { toServerDoc } from './sync.js';

const PW = 'ein-sicheres-passwort';
const STYLE: PdfStyle = { orgName: 'JF', footer: '', accent: '#c0392b', logo: '' };
/** Ein winziges, gültiges JPEG (1 × 1 Pixel). */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

let db: DatabaseSync;
let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await buildApp({ db, adminPassword: PW, pushTimer: false });
  token = (await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW, device: 'Test' } })).json().token as string;
});
afterEach(async () => {
  await app.close();
});

const auth = () => ({ authorization: `Bearer ${token}`, 'x-jfh-schema': '5' });

const photo = (blobId: string, attrs: Record<string, unknown> = {}) => ({ type: 'photo', attrs: { blobId, mime: 'image/jpeg', w: 1, h: 1, caption: 'Teich', ...attrs } });
const attachment = (blobId: string, name: string) => ({ type: 'attachment', attrs: { blobId, name, mime: 'application/pdf', size: 5 } });
const doc = (...content: unknown[]) => ({ type: 'doc', content }) as DocNode;

/** Legt ein Protokoll des Admins an, der Text als Yjs-Dokument (wie nach 3.0.0). */
function add(id: string, content: DocNode): string {
  const admin = (db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string }).id;
  return putProtocol(db, { id, title: 'Sitzung am Teich', ownerId: admin, content });
}
const pdfOf = async (id: string) => app.inject({ method: 'GET', url: `/api/protocols/${id}/pdf`, headers: auth() });

describe('PDF mit ausgelagerten Fotos', () => {
  it('setzt das Foto aus dem Blob in das PDF', async () => {
    storeBlob(db, { id: 'foto-0001', kind: 'photo', name: '', mime: 'image/jpeg', data: TINY_JPEG, uploaderId: 'x' });
    add('doc-0001', doc(photo('foto-0001')));
    const r = await pdfOf('doc-0001');
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(r.rawPayload.toString('latin1')).toContain('/DCTDecode');
  });

  it('ein Foto, das der Server nicht hat, verhindert das PDF nicht', async () => {
    add('doc-0001', doc(photo('foto-fehlt')));
    const r = await pdfOf('doc-0001');
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.toString('latin1')).not.toContain('/DCTDecode');
  });

  it('die Dokumentdefinition vermerkt ein fehlendes Foto im Text', () => {
    const d = toServerDoc({ ...sampleRow(), content: JSON.stringify(doc(photo('foto-fehlt', { caption: '' }))) });
    const text = JSON.stringify(buildDocDefinition(d, STYLE, { image: () => null }));
    expect(text).toContain('Foto nicht verfügbar');
    const withImage = JSON.stringify(buildDocDefinition(d, STYLE, { image: () => 'data:image/jpeg;base64,AAAA' }));
    expect(withImage).toContain('data:image/jpeg;base64,AAAA');
    expect(withImage).not.toContain('Foto nicht verfügbar');
  });

  it('ältere Protokolle mit Foto im Inhalt werden weiter ausgegeben', () => {
    const d = toServerDoc({ ...sampleRow(), content: JSON.stringify(doc({ type: 'photo', attrs: { src: `data:image/jpeg;base64,${TINY_JPEG.toString('base64')}`, w: 1, h: 1, caption: '' } })) });
    expect(JSON.stringify(buildDocDefinition(d, STYLE))).toContain('data:image/jpeg;base64,');
  });
});

describe('ZIP-Export mit Anhängen', () => {
  it('legt Fotos und Dateien unter attachments/ ab und bleibt dem Protokoll zuordenbar', async () => {
    storeBlob(db, { id: 'foto-0001', kind: 'photo', name: '', mime: 'image/jpeg', data: TINY_JPEG, uploaderId: 'x' });
    storeBlob(db, { id: 'datei-001', kind: 'file', name: 'Plan.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 hallo'), uploaderId: 'x' });
    add('doc-0001', doc(photo('foto-0001'), attachment('datei-001', 'Plan.pdf'), photo('foto-fehlt')));

    const zip = await app.inject({ method: 'GET', url: '/api/export.zip', headers: auth() });
    expect(zip.statusCode).toBe(200);
    const files = unzipSync(new Uint8Array(zip.rawPayload));
    const names = Object.keys(files);
    expect(names).toContain('attachments/foto-0001.jpg');
    expect(names).toContain('attachments/datei-001-Plan.pdf');
    expect(names.filter((n) => n.startsWith('attachments/'))).toHaveLength(2); // das fehlende Foto fehlt auch im Archiv
    expect(Buffer.compare(Buffer.from(files['attachments/foto-0001.jpg']!), TINY_JPEG)).toBe(0);
    expect(strFromU8(files['attachments/datei-001-Plan.pdf']!)).toBe('%PDF-1.4 hallo');
    // Das JSON verweist auf dieselben Kennungen.
    const json = Object.entries(files).find(([n]) => n.startsWith('json/'))!;
    expect(strFromU8(json[1])).toContain('foto-0001');
  });

  it('Anhänge nicht sichtbarer oder gelöschter Protokolle gehören nicht ins Archiv', async () => {
    storeBlob(db, { id: 'foto-0001', kind: 'photo', name: '', mime: 'image/jpeg', data: TINY_JPEG, uploaderId: 'x' });
    add('doc-0001', doc(photo('foto-0001')));
    const del = await app.inject({ method: 'POST', url: '/api/sync', headers: auth(), payload: { since: 0, protocols: [headerChange('doc-0001', { title: 'Sitzung am Teich', deleted: true })] } });
    expect(del.statusCode).toBe(200);
    const files = unzipSync(new Uint8Array((await app.inject({ method: 'GET', url: '/api/export.zip', headers: auth() })).rawPayload));
    expect(Object.keys(files).filter((n) => n.startsWith('attachments/'))).toEqual([]);
  });
});

describe('Verwaltung', () => {
  it('die Größe eines Protokolls zählt die Anhänge mit, die Übersicht nennt den Speicher', async () => {
    storeBlob(db, { id: 'foto-0001', kind: 'photo', name: '', mime: 'image/jpeg', data: Buffer.concat([TINY_JPEG, Buffer.alloc(5000)]), uploaderId: 'x' });
    add('doc-0001', doc(photo('foto-0001')));
    const list = (await app.inject({ method: 'GET', url: '/api/admin/protocols', headers: auth() })).json() as { id: string; size: number }[];
    expect(list.find((p) => p.id === 'doc-0001')!.size).toBeGreaterThan(5000);
    const info = (await app.inject({ method: 'GET', url: '/api/admin/info', headers: auth() })).json();
    expect(info).toMatchObject({ blobs: 1 });
    expect(info.blobBytes).toBeGreaterThan(5000);
  });
});

describe('Demo-Zurücksetzen', () => {
  it('räumt hochgeladene Anhänge ab und lässt keine Tabelle mit Besucherdaten stehen', async () => {
    const demoDb = openDb(':memory:');
    await resetDemo(demoDb);
    demoDb.prepare('INSERT INTO blobs(id, sha256, size, mime, name, kind, uploaderId, uploadedAt, data) VALUES(?,?,?,?,?,?,?,?,?)').run('besucher-1', 'h', 3, 'image/jpeg', '', 'photo', 'x', 1, Buffer.from([1, 2, 3]));
    demoDb.prepare("INSERT INTO blob_refs(blobId, protocolId) SELECT 'besucher-1', id FROM protocols LIMIT 1").run();
    await resetDemo(demoDb);

    // Alles, was nicht zu den Beispieldaten gehört, muss leer sein: Das gilt auch für Tabellen, die später dazukommen.
    const seeded = new Set(['users', 'config', 'records', 'folders', 'protocols', 'ydocs']);
    const tables = (demoDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
    for (const t of tables.filter((n) => !seeded.has(n))) {
      expect((demoDb.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n, t).toBe(0);
    }
  });
});

function sampleRow() {
  return {
    id: 'x-000001',
    title: 'T',
    folderId: '',
    datum: '2026-10-01',
    beginn: '',
    ende: '',
    ort: '',
    leitung: '',
    content: '{"type":"doc","content":[]}',
    ownerId: '',
    shared: 1,
    hiddenRev: null,
    rev: 1,
    updatedAt: 1,
    deletedAt: null,
    conflictRev: null,
    purgedAt: null,
    migratedFrom: null,
    ymode: 1,
    metaAt: '{}',
  };
}
