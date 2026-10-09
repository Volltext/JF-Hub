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
  marks?: { type: string }[];
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

function runs(nodes: Node[] | undefined): Any[] {
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

function blocks(nodes: Node[] | undefined, st: PdfStyle, depth = 0): Any[] {
  const out: Any[] = [];
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'paragraph': {
        const r = runs(n.content);
        out.push({ text: r.length ? r : ' ', margin: [0, 0, 0, 5], lineHeight: 1.25 });
        break;
      }
      case 'heading': {
        const level = Number(n.attrs?.level) || 1;
        const size = level === 1 ? 16 : level === 2 ? 13 : 11.5;
        out.push({
          text: runs(n.content),
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
        const items = (n.content ?? []).map((li) => ({ stack: blocks(li.content, st, depth + 1) }));
        out.push({
          [n.type === 'bulletList' ? 'ul' : 'ol']: items,
          margin: [depth ? 4 : 2, 0, 0, 5],
          markerColor: st.accent,
        });
        break;
      }
      case 'taskList': {
        for (const item of n.content ?? []) {
          out.push({
            columns: [checkbox(item.attrs?.checked === true, st.accent), { width: '*', stack: blocks(item.content, st, depth + 1) }],
            columnGap: 4,
            margin: [depth ? 4 : 2, 0, 0, 2],
          });
        }
        break;
      }
      case 'blockquote':
        out.push({
          table: { widths: [3, '*'], body: [[{ text: '', fillColor: st.accent, border: [false, false, false, false] }, { stack: blocks(n.content, st, depth), italics: true, color: MUTED, border: [false, false, false, false] }]] },
          layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: (i: number) => (i === 1 ? 10 : 0), paddingRight: () => 0, paddingTop: () => 2, paddingBottom: () => 2 },
          margin: [0, 2, 0, 6],
        });
        break;
      case 'codeBlock':
        out.push({ text: (n.content ?? []).map((c) => c.text ?? '').join(''), background: '#eef0f3', fontSize: 9.5, margin: [0, 2, 0, 6] });
        break;
      case 'ink': {
        const ink = inkDocOf(n.attrs);
        if (!ink) break;
        const page = n.attrs?.variant === 'page';
        const svg = inkSvg(ink, { fixedSize: true });
        // Seiten füllen eine eigene PDF-Seite (A4-Verhältnis); Zeichenflächen laufen mit dem Text mit.
        out.push({ svg, fit: [495, page ? 700 : 600], margin: [0, page ? 0 : 4, 0, page ? 0 : 8], ...(page ? { pageBreak: 'before' } : {}) });
        break;
      }
      case 'photo': {
        const src = typeof n.attrs?.src === 'string' ? n.attrs.src : '';
        // Nur JPEG-Data-URLs (so legt die App Fotos ab); alles andere würde den PDF-Bau stören.
        if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(src)) break;
        const caption = typeof n.attrs?.caption === 'string' ? n.attrs.caption.slice(0, 200) : '';
        out.push({ image: src, fit: [495, 600], alignment: 'center', margin: [0, 4, 0, caption ? 2 : 8] });
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
        if (n.content) out.push(...blocks(n.content, st, depth));
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
export function buildDocDefinition(doc: ServerDoc, st: PdfStyle): Any {
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
  content.push(...blocks((doc.content as Node)?.content, st));

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

export function renderPdf(doc: ServerDoc, st: PdfStyle): Promise<Buffer> {
  return renderDefinition(buildDocDefinition(doc, st));
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
