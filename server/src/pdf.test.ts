import { describe, expect, it } from 'vitest';
import { buildDocDefinition, renderDefinition, renderPdf, type PdfStyle } from './pdf.js';
import type { ServerDoc } from './sync.js';

const st: PdfStyle = { orgName: 'JF Musterstadt', footer: 'Fußzeile', accent: '#c0392b', logo: '' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const docOf = (content: unknown): ServerDoc => ({
  id: 'd1',
  title: '',
  folderId: '',
  datum: '',
  beginn: '',
  ende: '',
  ort: '',
  leitung: '',
  content,
  shared: false,
  ownerId: 'u1',
  rev: 1,
  updatedAt: 0,
  deleted: false,
});

const text = (t: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const para = (...c: object[]) => ({ type: 'paragraph', content: c });
const doc = (...c: object[]) => ({ type: 'doc', content: c });
const cell = (content: object[], attrs: Record<string, unknown> = {}, type = 'tableCell') => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null, ...attrs }, content });
const th = (t: string, attrs: Record<string, unknown> = {}) => cell([para(text(t))], attrs, 'tableHeader');
const td = (t: string, attrs: Record<string, unknown> = {}) => cell([para(text(t))], attrs);
const row = (...cells: object[]) => ({ type: 'tableRow', content: cells });
const table = (...rows: object[]) => ({ type: 'table', content: rows });

/** Alles nach Titel und Akzentlinie. */
const bodyOf = (content: unknown): Any[] => buildDocDefinition(docOf(content), st).content.slice(2);
const tableOf = (content: unknown): Any => {
  const t = bodyOf(content).find((b) => b.table);
  if (!t) throw new Error('keine Tabelle im PDF');
  return t;
};
/** Alle Textstücke einer pdfmake-Struktur, in Reihenfolge. */
function textsOf(x: unknown): string[] {
  if (typeof x === 'string') return [x];
  if (Array.isArray(x)) return x.flatMap(textsOf);
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return [...(o.text !== undefined ? textsOf(o.text) : []), ...(o.stack ? textsOf(o.stack) : []), ...(o.table ? textsOf((o.table as { body: unknown }).body) : []), ...(o.ul ? textsOf(o.ul) : []), ...(o.ol ? textsOf(o.ol) : [])];
  }
  return [];
}
const has = (x: unknown, key: string): boolean => {
  if (Array.isArray(x)) return x.some((v) => has(v, key));
  if (x && typeof x === 'object') return key in x || Object.values(x).some((v) => has(v, key));
  return false;
};
const isPdf = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-';

describe('PDF: Tabellen', () => {
  it('Zeilen, Zellen und Kopfzeile', () => {
    const t = tableOf(doc(table(row(th('Name'), th('Status')), row(td('Anna'), td('anwesend')))));
    expect(t.table.body).toHaveLength(2);
    expect(t.table.body[0]).toHaveLength(2);
    expect(t.table.headerRows).toBe(1);
    expect(t.table.widths).toHaveLength(2);
    expect(textsOf(t.table.body)).toEqual(['Name', 'Status', 'Anna', 'anwesend']);
    expect(t.table.body[0][0]).toMatchObject({ bold: true }); // Kopfzellen sind fett
  });

  it('ohne Kopfzellen gibt es keine Kopfzeile', () => {
    expect(tableOf(doc(table(row(td('a'), td('b'))))).table.headerRows).toBe(0);
  });

  it('Kopfzeilen sind die führenden Zeilen, die nur aus Kopfzellen bestehen', () => {
    expect(tableOf(doc(table(row(th('a'), th('b')), row(td('c'), td('d'))))).table.headerRows).toBe(1);
    expect(tableOf(doc(table(row(th('a'), th('b')), row(th('c'), th('d')), row(td('e'), td('f'))))).table.headerRows).toBe(2);
    expect(tableOf(doc(table(row(th('a'), td('b')), row(td('c'), td('d'))))).table.headerRows).toBe(0); // gemischt: keine Kopfzeile
    expect(tableOf(doc(table(row(td('a'), td('b')), row(th('c'), th('d'))))).table.headerRows).toBe(0); // Kopfzeile nicht vorn
  });

  it('verbundene Zellen: colSpan und rowSpan mit den Platzhaltern, die pdfmake verlangt', () => {
    //  A A B
    //  C D E
    //  C F G
    const t = tableOf(doc(table(row(td('A', { colspan: 2 }), td('B')), row(td('C', { rowspan: 2 }), td('D'), td('E')), row(td('F'), td('G')))));
    const [r1, r2, r3] = t.table.body as Any[][];
    expect(t.table.widths).toHaveLength(3);
    expect(r1).toHaveLength(3);
    expect(r1![0]).toMatchObject({ colSpan: 2 });
    expect(r1![1]).toEqual({});
    expect(textsOf(r1![2])).toEqual(['B']);
    expect(r2![0]).toMatchObject({ rowSpan: 2 });
    expect(r3![0]).toEqual({});
    expect(textsOf(r3)).toEqual(['F', 'G']);
  });

  it('Zeilen mit zu wenigen Zellen werden aufgefüllt', () => {
    const t = tableOf(doc(table(row(td('a'), td('b'), td('c')), row(td('d')))));
    expect(t.table.widths).toHaveLength(3);
    expect(t.table.body[1]).toHaveLength(3);
    expect(textsOf(t.table.body[1]).filter((x) => x.trim())).toEqual(['d']);
  });

  it('leere Zellen bekommen ein Leerzeichen, damit pdfmake sie zeichnet', () => {
    const t = tableOf(doc(table(row(cell([]), td('b')))));
    expect(t.table.body[0][0].stack).toEqual([{ text: ' ' }]);
  });

  it('Listen in Zellen bleiben Listen', () => {
    const list = { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('Schlauch'))] }, { type: 'listItem', content: [para(text('Strahlrohr'))] }] };
    const t = tableOf(doc(table(row(td('Material'), cell([list])))));
    expect(has(t.table.body[0][1], 'ul')).toBe(true);
    expect(textsOf(t.table.body[0][1])).toEqual(['Schlauch', 'Strahlrohr']);
  });

  it('Text vor und nach der Tabelle bleibt erhalten', () => {
    const body = bodyOf(doc(para(text('Davor')), table(row(td('x'))), para(text('Danach'))));
    expect(textsOf(body[0])).toEqual(['Davor']);
    expect(body[1].table).toBeDefined();
    expect(textsOf(body[2])).toEqual(['Danach']);
  });

  it('eine Tabelle ohne Zeilen oder ohne Zellen verschwindet, ohne etwas zu zerstören', () => {
    expect(bodyOf(doc(para(text('a')), { type: 'table', content: [] }, para(text('b')))).map(textsOf)).toEqual([['a'], ['b']]);
    expect(bodyOf(doc({ type: 'table', content: [row()] }))).toEqual([]);
    expect(bodyOf(doc({ type: 'table' }))).toEqual([]);
  });
});

describe('PDF: Tabellen gegen feindliche Eingaben', () => {
  it('riesige Spannen werden auf die Tabelle begrenzt', () => {
    const wide = tableOf(doc(table(row(td('A', { colspan: 1_000_000_000 })), row(td('B')))));
    expect(wide.table.widths.length).toBeLessThanOrEqual(24);
    for (const r of wide.table.body as Any[][]) expect(r).toHaveLength(wide.table.widths.length);
    const tall = tableOf(doc(table(row(td('A', { rowspan: 1_000_000_000 }), td('B')), row(td('C')))));
    expect(tall.table.body).toHaveLength(2);
    expect(tall.table.body[0][0]).toMatchObject({ rowSpan: 2 });
  });

  it('beides zugleich ergibt eine begrenzte Tabelle oder den Hinweis, aber keinen Absturz', () => {
    const body = bodyOf(doc(table(row(td('A', { colspan: 1_000_000_000, rowspan: 1_000_000_000 })), row(td('B')))));
    const t = body.find((b) => b.table);
    if (t) expect(t.table.widths.length).toBeLessThanOrEqual(24);
    else expect(textsOf(body).join(' ')).toMatch(/Tabelle zu groß für das PDF/);
  });

  it('ungültige Spannen (negativ, null, Text, Bruch) zählen als 1', () => {
    const t = tableOf(doc(table(row(td('A', { colspan: -3, rowspan: 0 }), td('B', { colspan: 'x', rowspan: 1.5 })))));
    expect(t.table.widths).toHaveLength(2);
    expect(textsOf(t.table.body)).toEqual(['A', 'B']);
  });

  it('eine viel zu große Tabelle wird durch einen Hinweis ersetzt', () => {
    const big = doc(table(...Array.from({ length: 5000 }, () => row(...Array.from({ length: 50 }, () => td('x'))))));
    const body = bodyOf(big);
    expect(body.some((b) => b.table)).toBe(false);
    expect(textsOf(body).join(' ')).toMatch(/Tabelle zu groß für das PDF/);
  });

  it('die Spaltenbreiten sind feste Zahlen, die samt Rändern und Linien auf die Seite passen (lange Wörter schieben keine Spalte hinaus)', () => {
    for (const cols of [1, 2, 3, 5, 6, 8, 12, 13, 24]) {
      const t = tableOf(doc(table(row(...Array.from({ length: cols }, (_, i) => td(`Fahrgemeinschaften${i}`))))));
      expect(t.table.widths, `${cols} Spalten`).toHaveLength(cols);
      for (const w of t.table.widths) expect(typeof w, `${cols} Spalten`).toBe('number');
      const total = (t.table.widths as number[]).reduce((a, b) => a + b, 0) + cols * (t.layout.paddingLeft() + t.layout.paddingRight()) + (cols + 1) * t.layout.vLineWidth();
      expect(total, `${cols} Spalten`).toBeLessThanOrEqual(495.001); // Seitenbreite ohne Ränder
      expect(total, `${cols} Spalten`).toBeGreaterThan(480); // und nicht unnötig schmal
    }
  });

  it('Zeilen dürfen über den Seitenumbruch laufen: mit dontBreakRows verlöre pdfmake eine Zeile, die höher ist als eine Seite, ganz', () => {
    const t = tableOf(doc(table(row(td('kurz'), cell(Array.from({ length: 300 }, (_, i) => para(text(`Absatz ${i}`)))))))); // höher als eine Seite
    expect(t.table).not.toHaveProperty('dontBreakRows');
    expect(textsOf(t.table.body)).toHaveLength(301);
  });

  it('eine Tabelle in einer Zelle wird nicht verschachtelt, ihr Text bleibt lesbar', () => {
    const inner = table(row(td('innen')));
    const t = tableOf(doc(table(row(cell([para(text('außen')), inner])))));
    expect(has(t.table.body, 'table')).toBe(false);
    expect(textsOf(t.table.body)).toEqual(['außen', 'innen']);
  });

  it('Seitenumbrüche aus Zellen (Handschrift-Seite) werden unterdrückt', () => {
    const ink = { type: 'ink', attrs: { variant: 'page', ink: { w: 800, h: 1131, bg: 'none', s: [] } } };
    const t = tableOf(doc(table(row(cell([ink, para(text('x'))])))));
    expect(has(t.table.body, 'pageBreak')).toBe(false);
  });

  it('jede dieser Tabellen lässt sich zu einem PDF rendern', async () => {
    const docs = [
      doc(table(row(th('Name'), th('Status')), row(td('Anna'), td('anwesend')))),
      doc(table(row(td('A', { colspan: 2 }), td('B')), row(td('C', { rowspan: 2 }), td('D'), td('E')), row(td('F'), td('G')))),
      doc(table(row(td('A', { colspan: 1_000_000_000, rowspan: 1_000_000_000 })), row(td('B')))),
      doc(table(row(cell([para(text('außen')), table(row(td('innen')))])))),
      doc(table(row(cell([{ type: 'ink', attrs: { variant: 'page', ink: { w: 800, h: 1131, bg: 'none', s: [] } } }]), cell([{ type: 'photo', attrs: { blobId: 'fehlt-0001' } }, { type: 'horizontalRule' }])))),
      doc(table(...Array.from({ length: 120 }, (_, i) => row(td(`Zeile ${i}`), td('x'))), row(th('Kopf')))),
      doc(table(...Array.from({ length: 5000 }, () => row(...Array.from({ length: 50 }, () => td('x')))))),
    ];
    for (const d of docs) expect(isPdf(await renderPdf(docOf(d), st))).toBe(true);
  }, 60_000);
});

describe('PDF: Links und Hervorhebung', () => {
  const runOf = (marks: { type: string; attrs?: Record<string, unknown> }[]) => bodyOf(doc(para(text('Text', marks))))[0].text[0];
  const link = (href: unknown) => ({ type: 'link', attrs: { href } });

  it('ein Link wird anklickbar, unterstrichen und in der Akzentfarbe gesetzt', () => {
    expect(runOf([link('https://example.de/seite')])).toMatchObject({ text: 'Text', link: 'https://example.de/seite', decoration: 'underline', color: st.accent });
    expect(runOf([link('https://example.de')])).toMatchObject({ link: 'https://example.de/' }); // so schreibt die URL-Klasse die Adresse
    expect(runOf([link('mailto:anna@example.de')])).toMatchObject({ link: 'mailto:anna@example.de' });
    expect(runOf([link('tel:+491701234567')])).toMatchObject({ link: 'tel:+491701234567' });
  });

  it('Links mit anderen Zielen erscheinen nur als Text', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://example.de', '/relativ', '#anker', 'example.de', '', null, 42]) {
      const run = runOf([link(bad)]);
      expect(run, String(bad)).toMatchObject({ text: 'Text' });
      expect(run, String(bad)).not.toHaveProperty('link');
      expect(run, String(bad)).not.toHaveProperty('decoration');
    }
  });

  it('Adressen mit Umlauten oder internationalen Domains stehen als reines ASCII im PDF (UTF-16 mit BOM wäre ungültig)', () => {
    const run = runOf([link('https://müller-feuerwehr.de/größe?q=ä')]);
    expect(run.link).toMatch(/^https:\/\/xn--[a-z0-9-]+\.de\/gr%C3%B6%C3%9Fe\?q=%C3%A4$/);
    expect(runOf([link('mailto:anna@exämple.de')]).link).toMatch(/^mailto:anna@ex%C3%A4mple\.de$/);
    for (const href of ['https://example.de/ä', 'https://bücher.example/straße', 'mailto:jörg@example.de']) expect(runOf([link(href)]).link, href).toMatch(/^[\x21-\x7e]+$/);
  });

  it('ein Link ohne Angaben (attrs fehlt) stört nicht', () => {
    expect(runOf([{ type: 'link' }])).not.toHaveProperty('link');
  });

  it('Link und Fettdruck lassen sich verbinden', () => {
    expect(runOf([{ type: 'bold' }, link('https://example.de/x')])).toMatchObject({ bold: true, link: 'https://example.de/x' });
  });

  it('Hervorhebung ist ein farbiger Hintergrund; eine eigene Farbe nur als #rrggbb', () => {
    expect(runOf([{ type: 'highlight', attrs: { color: null } }])).toMatchObject({ background: '#fff2a8' });
    expect(runOf([{ type: 'highlight' }])).toMatchObject({ background: '#fff2a8' });
    expect(runOf([{ type: 'highlight', attrs: { color: '#B7F0C0' } }])).toMatchObject({ background: '#b7f0c0' });
    for (const bad of ['red', 'red;x', '#fff', 'url(x)', 42]) expect(runOf([{ type: 'highlight', attrs: { color: bad } }]), String(bad)).toMatchObject({ background: '#fff2a8' });
  });

  it('beides in einer Tabellenzelle rendert zu einem PDF', async () => {
    const d = doc(table(row(cell([para(text('Seite', [link('https://example.de')]), text(' wichtig', [{ type: 'highlight', attrs: { color: null } }]))]))));
    expect(isPdf(await renderPdf(docOf(d), st))).toBe(true);
  });
});

describe('PDF: bestehende Elemente (Regression)', () => {
  it('Absatz, Überschrift, Liste, Checkliste, Zitat, Trennlinie und Anhang bleiben unverändert', async () => {
    const d = doc(
      { type: 'heading', attrs: { level: 1 }, content: [text('Überschrift')] },
      para(text('fett', [{ type: 'bold' }]), text(' kursiv', [{ type: 'italic' }]), text(' unter', [{ type: 'underline' }])),
      { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('Punkt'))] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [para(text('Eins'))] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [para(text('Erledigt'))] }] },
      { type: 'blockquote', content: [para(text('Zitat'))] },
      { type: 'horizontalRule' },
      { type: 'attachment', attrs: { name: 'Plan.pdf', size: 2048 } },
      { type: 'photo', attrs: { blobId: 'fehlt-0001', caption: 'Teich' } },
    );
    const body = bodyOf(d);
    expect(body).toHaveLength(9);
    expect(textsOf(body[0])).toEqual(['Überschrift']);
    expect(textsOf(body[8]).join('')).toContain('Foto nicht verfügbar');
    expect(isPdf(await renderPdf(docOf(d), st))).toBe(true);
    expect(isPdf(await renderDefinition(buildDocDefinition(docOf(d), st)))).toBe(true);
  });
});
