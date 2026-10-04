import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { openDb } from './db.js';
import { buildClothingDoc, parseClothingPdf, tint, type ClothingPdfRequest } from './clothingPdf.js';

const st = { orgName: 'JF Musterstadt', footer: 'Fußzeile', accent: '#e5372e', logo: '' };

const sample: ClothingPdfRequest = {
  date: '2026-10-04',
  items: ['Kombi-Jacke', 'Kombi-Hose', 'Regenjacke', 'Handschuhe'],
  groups: [
    {
      label: 'Jugendliche',
      rows: [
        { name: 'Elias', current: ['52', '52', 'S', ''], wanted: ['56', '', 'M', ''], fresh: [true, false, false, false] },
        { name: 'Linus', current: ['176', '170', '165 / XS', ''], wanted: ['', '', '', ''], fresh: [false, false, false, false] },
      ],
    },
    { label: 'Betreuer', rows: [{ name: 'Max', current: ['54', '', '', '9'], wanted: ['', '', '', ''], fresh: [false, false, false, false] }] },
  ],
  totals: [
    { item: 'Kombi-Jacke', sizes: [{ size: '56', count: 1 }] },
    { item: 'Regenjacke', sizes: [{ size: 'M', count: 1 }] },
  ],
};

/** Alle Text-Zellen der Größenübersicht (zweite Tabelle). */
const sizeTable = (def: { content: { table?: { body: { text?: string; fillColor?: string }[][] } }[] }) => def.content.filter((c) => c.table).at(-1)!.table!.body;

describe('Kleidertabelle als PDF', () => {
  it('setzt Kopf wie die Excel-Liste: aktuell links, neu rechts', () => {
    const body = sizeTable(buildClothingDoc(sample, st));
    expect(body[0]![1]).toMatchObject({ text: 'Aktuelle Größe', colSpan: 4 });
    expect(body[0]![5]).toMatchObject({ text: 'Neu zu beschaffen', colSpan: 4 });
    const heads = ['Kombi-Jacke', 'Kombi-Hose', 'Regen-\njacke', 'Hand-\nschuhe'];
    expect(body[1]!.map((c) => c.text)).toEqual(['Name', ...heads, ...heads]);
    // Gruppenzeilen, weil es zwei Gruppen gibt
    expect(body[2]![0]).toMatchObject({ text: 'Jugendliche', colSpan: 9 });
  });

  it('hebt nur neue Wünsche hervor und erklärt die Markierung', () => {
    const def = buildClothingDoc(sample, st);
    const elias = sizeTable(def)[3]!;
    expect(elias[0]!.text).toBe('Elias');
    expect(elias[5]).toMatchObject({ text: '56', fillColor: tint('#e5372e') });
    expect(elias[7]!.text).toBe('M');
    expect(elias[7]!.fillColor).not.toBe(tint('#e5372e'));
    expect(JSON.stringify(def.content)).toContain('neu seit der letzten Liste');
  });

  it('druckt bei vielen Kleidungsstücken quer', () => {
    const many = { ...sample, items: ['A', 'B', 'C', 'D', 'E', 'F'] };
    expect(buildClothingDoc(parseClothingPdf(many), st).pageOrientation).toBe('landscape');
    expect(buildClothingDoc(sample, st).pageOrientation).toBe('portrait');
  });

  it('prüft und begrenzt die Anfrage', () => {
    expect(() => parseClothingPdf({ items: [] })).toThrow();
    const p = parseClothingPdf({ date: 'gestern', items: ['Jacke'], groups: [{ label: 'X', rows: [{ name: 'A', current: ['1', '2', '3'], fresh: 'ja' }] }], totals: [{ item: 'Jacke', sizes: [{ size: '1', count: '3' }] }] });
    expect(p.groups[0]!.rows[0]).toEqual({ name: 'A', current: ['1'], wanted: [''], fresh: [false] });
    expect(p.totals[0]!.sizes[0]!.count).toBe(3);
    expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('tönt die Akzentfarbe auf', () => {
    expect(tint('#000000', 0.5)).toBe('#808080');
    expect(tint('kaputt')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('POST /api/clothing/pdf', () => {
  let app: FastifyInstance;
  const PW = 'ein-sicheres-passwort';
  beforeEach(async () => {
    app = await buildApp({ db: openDb(':memory:'), adminPassword: PW, pushTimer: false });
  });
  afterEach(async () => {
    await app.close();
  });

  it('liefert ein PDF nur mit Anmeldung', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/clothing/pdf', payload: sample })).statusCode).toBe(401);
    const token = (await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW } })).json().token as string;
    const headers = { authorization: `Bearer ${token}` };
    const r = await app.inject({ method: 'POST', url: '/api/clothing/pdf', headers, payload: sample });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await app.inject({ method: 'POST', url: '/api/clothing/pdf', headers, payload: { items: [] } })).statusCode).toBe(400);
  });
});
