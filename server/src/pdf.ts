import { createRequire } from 'node:module';
import { inkSvg } from './inkSvg.js';
import type { ServerDoc } from './sync.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface PdfStyle {
  orgName: string;
  footer: string;
  accent: string;
  /** Data-URL (PNG/JPEG) oder leer. */
  logo: string;
}

interface Node {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: Node[];
}

/** Handschrift-Knoten: Attribut `ink` stammt vom Client und wird hier nur lesend und defensiv verwendet. */
function inkDocOf(attrs: Record<string, unknown> | undefined) {
  const raw = attrs?.ink as { w?: unknown; h?: unknown; bg?: unknown; s?: unknown } | null | undefined;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.s)) return null;
  const n = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const s = raw.s.flatMap((it: { t?: unknown; c?: unknown; w?: unknown; p?: unknown }) => {
    if (!it || !Array.isArray(it.p) || it.p.length < 3) return [];
    const p = it.p.map((x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0));
    p.length -= p.length % 3;
    return [{ t: it.t === 'h' ? 'h' : 'p', c: typeof it.c === 'string' && /^#[0-9a-fA-F]{6}$/.test(it.c) ? it.c : '#1b1d21', w: n(it.w, 2.4, 0.3, 80), p }];
  });
  return { w: n(raw.w, 800, 100, 4000), h: n(raw.h, 1131, 100, 20000), bg: typeof raw.bg === 'string' ? raw.bg : 'none', s };
}

export const TEXT = '#1c1e22';
export const MUTED = '#6b7280';
export const RULE = '#d9dce1';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const LINK = /^(?:https?:\/\/[^\s/?#\\@]\S*|mailto:\S+|tel:\+?[0-9().-]*[0-9][0-9().-]*)$/i;

/** Nur http(s), mailto und tel kommen als anklickbarer Link ins PDF (dieselbe Allowlist wie im Editor), alles andere bleibt Text. */
function safeLink(href: unknown): string | null {
  return typeof href === 'string' && href.length <= 2000 && !CONTROL.test(href) && LINK.test(href) ? href : null;
}

const hexColor = (v: unknown): string | null => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
const MARKER = '#fff2a8';

function runs(nodes: Node[] | undefined, st: PdfStyle): Any[] {
  const out: Any[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out.push({ text: '\n' });
      continue;
    }
    if (n.type !== 'text' || !n.text) continue;
    const run: Any = { text: n.text };
    for (const m of n.marks ?? []) {
      if (m.type === 'bold') run.bold = true;
      else if (m.type === 'italic') run.italics = true;
      else if (m.type === 'underline') run.decoration = 'underline';
      else if (m.type === 'strike') run.decoration = 'lineThrough';
      else if (m.type === 'code') run.background = '#eef0f3';
      else if (m.type === 'highlight') run.background = hexColor(m.attrs?.color) ?? MARKER;
      else if (m.type === 'link') {
        const href = safeLink(m.attrs?.href);
        if (href) Object.assign(run, { link: href, decoration: 'underline', color: st.accent });
      }
    }
    out.push(run);
  }
  return out;
}

function checkbox(checked: boolean, accent: string): Any {
  const canvas: Any[] = [{ type: 'rect', x: 0, y: 1.5, w: 9, h: 9, r: 1.5, lineWidth: 1, lineColor: MUTED }];
  if (checked) {
    canvas.push({
      type: 'polyline',
      lineWidth: 1.6,
      lineColor: accent,
      closePath: false,
      points: [
        { x: 2, y: 6 },
        { x: 4, y: 8.5 },
        { x: 8, y: 3 },
      ],
    });
  }
  return { width: 14, canvas };
}

/** Liefert zu einem Anhang-Verweis das Foto als JPEG-Data-URL, oder null, wenn der Server es nicht hat. */
export type ImageLoader = (blobId: string) => string | null;

export interface PdfOptions {
  /** Ohne Lader zeigt das PDF nur Fotos, die noch im Inhalt stecken (ältere Protokolle). */
  image?: ImageLoader;
}

// Grenzen für Tabellen im PDF: Was darüber liegt, ersetzt ein Hinweis (feindliche oder versehentlich riesige Eingaben).
const TABLE_MAX_ROWS = 400;
const TABLE_MAX_COLS = 24;
const TABLE_MAX_CELLS = 4000;
const TABLE_MAX_HEADER_ROWS = 3;
const HEAD_FILL = '#eef0f3';

const isCell = (n: Node | undefined): n is Node => n?.type === 'tableCell' || n?.type === 'tableHeader';
/** Spannweite einer Zelle: ganze Zahl ab 1, höchstens `max`; alles andere zählt als 1. */
const spanOf = (v: unknown, max: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? Math.min(v, max) : 1);

function tableNotice(rows: number, cols: number): Any {
  return { text: [{ text: `Tabelle zu groß für das PDF (${rows} Zeilen × ${cols} Spalten).`, italics: true }], color: MUTED, fontSize: 9.5, margin: [0, 4, 0, 8] };
}

interface Placed {
  cell: Node;
  /** Die Zelle beginnt hier; sonst wird die Stelle nur von einer verbundenen Zelle (colSpan/rowSpan) überdeckt. */
  origin: boolean;
  colSpan: number;
  rowSpan: number;
}

/**
 * Eine Tabelle als pdfmake-Tabelle. Die Zellen werden auf ein Raster gelegt wie in HTML (verbundene Zellen belegen mehrere Plätze,
 * pdfmake verlangt dafür leere Platzhalter), fehlende Zellen aufgefüllt. Liefert null bei einer leeren Tabelle.
 */
function tableBlock(n: Node, st: PdfStyle, depth: number, image?: ImageLoader): Any | null {
  const rows = (n.content ?? []).filter((r) => r?.type === 'tableRow');
  if (!rows.length) return null;
  if (rows.length > TABLE_MAX_ROWS) {
    let widest = 0;
    for (const r of rows) widest = Math.max(widest, r.content?.length ?? 0);
    return tableNotice(rows.length, widest);
  }

  const grid: (Placed | undefined)[][] = rows.map(() => []);
  let cols = 0;
  let count = 0;
  for (let r = 0; r < rows.length; r++) {
    let c = 0;
    for (const cell of (rows[r]!.content ?? []).filter(isCell)) {
      while (grid[r]![c]) c++; // Plätze überspringen, die eine Zelle von oben belegt
      if (c >= TABLE_MAX_COLS || ++count > TABLE_MAX_CELLS) return tableNotice(rows.length, Math.max(cols, c + 1));
      const colSpan = spanOf(cell.attrs?.colspan, TABLE_MAX_COLS - c);
      const rowSpan = spanOf(cell.attrs?.rowspan, rows.length - r);
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) grid[r + dr]![c + dc] = { cell, origin: dr === 0 && dc === 0, colSpan, rowSpan };
      }
      c += colSpan;
      cols = Math.max(cols, c);
    }
  }
  if (!cols) return null;

  // Kopfzeilen: die führenden Zeilen, die nur aus Kopfzellen bestehen (wiederholt auf jeder Seite). Eine Kopfzelle, die über die
  // Kopfzeilen hinausreicht, macht aus der Kopfzeile gewöhnliche Zeilen: pdfmake kann das nicht wiederholen.
  let headerRows = 0;
  while (headerRows < Math.min(rows.length - 1, TABLE_MAX_HEADER_ROWS)) {
    const cells = (rows[headerRows]!.content ?? []).filter(isCell);
    if (!cells.length || !cells.every((c) => c.type === 'tableHeader')) break;
    headerRows++;
  }
  for (let r = 0; r < headerRows; r++) if (grid[r]!.some((p) => p?.origin && r + p.rowSpan > headerRows)) headerRows = 0;

  const body = grid.map((line) =>
    Array.from({ length: cols }, (_, c): Any => {
      const p = line[c];
      if (!p) return { text: ' ' }; // Lücke: pdfmake braucht überall eine Zelle
      if (!p.origin) return {}; // von einer verbundenen Zelle überdeckt
      const content = blocks(p.cell.content, st, depth + 1, image, true);
      return {
        stack: content.length ? content : [{ text: ' ' }],
        ...(p.cell.type === 'tableHeader' ? { bold: true, fillColor: HEAD_FILL } : {}),
        ...(p.colSpan > 1 ? { colSpan: p.colSpan } : {}),
        ...(p.rowSpan > 1 ? { rowSpan: p.rowSpan } : {}),
      };
    }),
  );

  // Bewusst kein `dontBreakRows`: pdfmake lässt eine Zeile, die höher ist als eine Seite, damit stumm komplett weg (geprüft mit 300
  // Absätzen in einer Zelle); eine Zeile über den Seitenumbruch zu teilen sieht schlechter aus, verliert aber keinen Text.
  return {
    table: { headerRows, widths: Array.from({ length: cols }, () => '*'), body },
    layout: {
      hLineWidth: () => 0.6,
      vLineWidth: () => 0.6,
      hLineColor: () => RULE,
      vLineColor: () => RULE,
      paddingLeft: () => 5,
      paddingRight: () => 5,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 2, 0, 8],
  };
}

/**
 * Wandelt Knoten in pdfmake-Blöcke. `inCell`: Der Inhalt steht in einer Tabellenzelle (Tabellen werden dort nicht verschachtelt,
 * Seitenumbrüche entfallen, Bilder werden kleiner, damit eine feindliche Eingabe das Layout nicht sprengt).
 */
function blocks(nodes: Node[] | undefined, st: PdfStyle, depth = 0, image?: ImageLoader, inCell = false): Any[] {
  const out: Any[] = [];
  const add = (items: Any[]) => {
    for (const item of items) out.push(item); // eine Schleife statt push(...items): große Dokumente sprengen sonst den Stack
  };
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'paragraph': {
        const r = runs(n.content, st);
        out.push({ text: r.length ? r : ' ', margin: [0, 0, 0, inCell ? 2 : 5], lineHeight: 1.25 });
        break;
      }
      case 'heading': {
        const level = Number(n.attrs?.level) || 1;
        const size = level === 1 ? 16 : level === 2 ? 13 : 11.5;
        out.push({
          text: runs(n.content, st),
          bold: true,
          fontSize: size,
          color: level === 1 ? st.accent : TEXT,
          margin: [0, level === 1 ? 12 : 9, 0, 4],
          keepWithNext: true,
        } as Any);
        break;
      }
      case 'bulletList':
      case 'orderedList': {
        const items = (n.content ?? []).map((li) => ({ stack: blocks(li.content, st, depth + 1, image, inCell) }));
        out.push({
          [n.type === 'bulletList' ? 'ul' : 'ol']: items,
          margin: [depth ? 4 : 2, 0, 0, inCell ? 2 : 5],
          markerColor: st.accent,
        });
        break;
      }
      case 'taskList': {
        for (const item of n.content ?? []) {
          out.push({
            columns: [checkbox(item.attrs?.checked === true, st.accent), { width: '*', stack: blocks(item.content, st, depth + 1, image, inCell) }],
            columnGap: 4,
            margin: [depth ? 4 : 2, 0, 0, 2],
          });
        }
        break;
      }
      case 'blockquote':
        out.push({
          table: { widths: [3, '*'], body: [[{ text: '', fillColor: st.accent, border: [false, false, false, false] }, { stack: blocks(n.content, st, depth, image, inCell), italics: true, color: MUTED, border: [false, false, false, false] }]] },
          layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: (i: number) => (i === 1 ? 10 : 0), paddingRight: () => 0, paddingTop: () => 2, paddingBottom: () => 2 },
          margin: [0, 2, 0, 6],
        });
        break;
      case 'codeBlock':
        out.push({ text: (n.content ?? []).map((c) => c.text ?? '').join(''), background: '#eef0f3', fontSize: 9.5, margin: [0, 2, 0, 6] });
        break;
      case 'table': {
        if (inCell) {
          add(blocks(n.content, st, depth, image, true)); // nicht verschachteln: nur der Text bleibt
          break;
        }
        const table = tableBlock(n, st, depth, image);
        if (table) out.push(table);
        break;
      }
      case 'ink': {
        const ink = inkDocOf(n.attrs);
        if (!ink) break;
        const page = n.attrs?.variant === 'page' && !inCell;
        const svg = inkSvg(ink, { fixedSize: true });
        // Seiten füllen eine eigene PDF-Seite (A4-Verhältnis); Zeichenflächen laufen mit dem Text mit.
        out.push({ svg, fit: inCell ? [120, 160] : [495, page ? 700 : 600], margin: [0, page ? 0 : 4, 0, page ? 0 : 8], ...(page ? { pageBreak: 'before' } : {}) });
        break;
      }
      case 'photo': {
        const blobId = typeof n.attrs?.blobId === 'string' ? n.attrs.blobId : '';
        // Seit 2.2.0 verweist das Foto auf einen Blob; ältere Protokolle tragen es noch als Data-URL im Inhalt.
        const src = blobId ? (image?.(blobId) ?? '') : typeof n.attrs?.src === 'string' ? n.attrs.src : '';
        const caption = typeof n.attrs?.caption === 'string' ? n.attrs.caption.slice(0, 200) : '';
        // Nur JPEG-Data-URLs (so legt die App Fotos ab); alles andere würde den PDF-Bau stören.
        if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(src)) {
          if (blobId) out.push({ text: [{ text: 'Foto nicht verfügbar', italics: true }, ...(caption ? [{ text: `  (${caption})` }] : [])], color: MUTED, fontSize: 9.5, alignment: 'center', margin: [0, 4, 0, 8] });
          break;
        }
        out.push({ image: src, fit: inCell ? [120, 160] : [495, 600], alignment: 'center', margin: [0, 4, 0, caption ? 2 : 8] });
        if (caption) out.push({ text: caption, color: MUTED, fontSize: 9, alignment: 'center', margin: [0, 0, 0, 8] });
        break;
      }
      case 'attachment': {
        const name = typeof n.attrs?.name === 'string' ? n.attrs.name.slice(0, 120) : 'Datei';
        const size = typeof n.attrs?.size === 'number' ? n.attrs.size : 0;
        const kb = size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(size / 1024))} kB`;
        out.push({ text: [{ text: 'Anhang: ', color: MUTED }, { text: name, bold: true }, { text: `  (${kb})`, color: MUTED }], fontSize: 10, margin: [0, 2, 0, 6] });
        break;
      }
      case 'horizontalRule':
        out.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 495, y2: 0, lineWidth: 0.7, lineColor: RULE }], margin: [0, 6, 0, 8] });
        break;
      default:
        if (n.content) add(blocks(n.content, st, depth, image, inCell));
    }
  }
  return out;
}

function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const wd = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][d.getDay()];
  return `${wd}, ${m[3]}.${m[2]}.${m[1]}`;
}

/** Baut die pdfmake-Dokumentdefinition (rein, ohne I/O – gut testbar). */
export function buildDocDefinition(doc: ServerDoc, st: PdfStyle, opts: PdfOptions = {}): Any {
  const meta: [string, string][] = [];
  if (doc.datum) meta.push(['Datum', formatDate(doc.datum)]);
  if (doc.beginn || doc.ende) meta.push(['Zeit', [doc.beginn, doc.ende].filter(Boolean).join(' – ') + ' Uhr']);
  if (doc.ort) meta.push(['Ort', doc.ort]);
  if (doc.leitung) meta.push(['Protokoll', doc.leitung]);

  const content: Any[] = [{ text: doc.title || 'Protokoll', fontSize: 22, bold: true, color: TEXT, margin: [0, 0, 0, 6] }];
  if (meta.length) {
    content.push({
      table: { widths: [70, '*'], body: meta.map(([k, v]) => [{ text: k, color: MUTED, fontSize: 9.5 }, { text: v, fontSize: 10.5 }]) },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingTop: () => 2, paddingBottom: () => 2 },
    });
  }
  content.push(accentRule(st));
  for (const block of blocks((doc.content as Node)?.content, st, 0, opts.image)) content.push(block);

  return { ...pageFrame(st, doc.title || 'Protokoll'), content };
}

/** Linie in der Akzentfarbe unter dem Titel. */
export function accentRule(st: PdfStyle, width = 495): Any {
  return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 1.5, lineColor: st.accent }], margin: [0, 8, 0, 10] };
}

/** Gemeinsamer Seitenrahmen aller PDFs: A4, Kopf mit Organisation und Logo, Fußzeile mit Seitenzahl. */
export function pageFrame(st: PdfStyle, title: string, orientation: 'portrait' | 'landscape' = 'portrait'): Any {
  return {
    pageSize: 'A4',
    pageOrientation: orientation,
    pageMargins: [50, 70, 50, 60],
    info: { title, creator: 'JF Hub' },
    defaultStyle: { font: 'Roboto', fontSize: 10.5, color: TEXT },
    header: () => ({
      margin: [50, 24, 50, 0],
      columns: [
        { text: st.orgName, color: MUTED, fontSize: 9, bold: true, margin: [0, 4, 0, 0] },
        st.logo ? { image: st.logo, fit: [80, 28], alignment: 'right' } : { text: '' },
      ],
    }),
    footer: (page: number, pages: number) => ({
      margin: [50, 0, 50, 0],
      columns: [
        { text: st.footer, color: MUTED, fontSize: 8.5 },
        { text: `Seite ${page} von ${pages}`, color: MUTED, fontSize: 8.5, alignment: 'right' },
      ],
    }),
  };
}

let printer: Any;
function getPrinter(): Any {
  if (!printer) {
    const PdfPrinter = require('pdfmake');
    const vfs = require('pdfmake/build/vfs_fonts.js') as Record<string, string>;
    const f = (name: string) => Buffer.from(vfs[name]!, 'base64');
    printer = new PdfPrinter({
      Roboto: {
        normal: f('Roboto-Regular.ttf'),
        bold: f('Roboto-Medium.ttf'),
        italics: f('Roboto-Italic.ttf'),
        bolditalics: f('Roboto-MediumItalic.ttf'),
      },
    });
  }
  return printer;
}

export function renderPdf(doc: ServerDoc, st: PdfStyle, opts: PdfOptions = {}): Promise<Buffer> {
  return renderDefinition(buildDocDefinition(doc, st, opts));
}

/** Rendert eine pdfmake-Dokumentdefinition zu PDF-Bytes. */
export function renderDefinition(definition: Any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = getPrinter().createPdfKitDocument(definition);
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.end();
  });
}

/** Reinigt Text für Dateinamen: nur Buchstaben, Ziffern, Leerzeichen und `._-`; reine Punkte (`.`, `..`) sind kein Name. */
export function safeFileName(text: string, fallback: string, max = 80): string {
  const clean = text.replace(/[^\p{L}\p{N} ._-]+/gu, '').trim().slice(0, max).trim();
  return /^\.*$/.test(clean) ? fallback : clean;
}

export function pdfFileName(doc: ServerDoc): string {
  return safeFileName([doc.datum, doc.title || 'Protokoll'].filter(Boolean).join(' '), 'Protokoll');
}
