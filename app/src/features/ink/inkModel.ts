/**
 * Datenformat für Handschrift. Wird als Attribut des TipTap-Knotens `ink` im Protokolltext gespeichert,
 * deshalb laufen Sync, Offline-Betrieb und Server unverändert mit.
 *
 * Koordinaten sind „Blatteinheiten“: das Blatt ist immer `w` Einheiten breit (Standard 800), die
 * Bildschirmgröße spielt keine Rolle. Der Server liest dasselbe Format (jf-hub-server/src/inkSvg.ts).
 */

export type InkBg = 'none' | 'lined' | 'grid' | 'dots';
export type InkVariant = 'block' | 'page';

export interface InkStroke {
  /** p = Stift, h = Textmarker */
  t: 'p' | 'h';
  /** #rrggbb */
  c: string;
  /** Grundbreite in Blatteinheiten */
  w: number;
  /** x, y, Druck (0–1) als flache Dreiergruppen */
  p: number[];
  /** Zeitabstand zum vorigen Punkt in ms (nur von der Android-App; hält das Strichbild beim Wiederöffnen gleich) */
  d?: number[];
  /** Länge einer Blatteinheit in cm auf dem Gerät, auf dem geschrieben wurde (nur Android-App) */
  u?: number;
}

export interface InkDoc {
  v: 1;
  w: number;
  h: number;
  bg: InkBg;
  s: InkStroke[];
}

export const INK_WIDTH = 800;
/** DIN A4 im Verhältnis zur Blattbreite. */
export const INK_PAGE_HEIGHT = 1131;
export const INK_BLOCK_MIN_HEIGHT = 360;
export const INK_BLOCK_MAX_HEIGHT = 6000;

export const INK_COLORS = ['#1b1d21', '#d32f2f', '#1565c0', '#2e7d32', '#ef6c00', '#6a1b9a'];
export const INK_HIGHLIGHT_COLORS = ['#fdd835', '#69f0ae', '#40c4ff', '#ff80ab', '#ffab40'];

export function emptyInk(variant: InkVariant): InkDoc {
  return {
    v: 1,
    w: INK_WIDTH,
    h: variant === 'page' ? INK_PAGE_HEIGHT : INK_BLOCK_MIN_HEIGHT,
    bg: variant === 'page' ? 'lined' : 'none',
    s: [],
  };
}

const BGS: InkBg[] = ['none', 'lined', 'grid', 'dots'];
const COLOR = /^#[0-9a-fA-F]{6}$/;

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Prüft/bereinigt unbekannte Daten (z. B. vom Server oder aus alten Versionen); null = nicht lesbar. */
export function normalizeInk(raw: unknown): InkDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.s)) return null;
  const s: InkStroke[] = [];
  for (const it of r.s) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    if (!Array.isArray(o.p) || o.p.length < 3) continue;
    const p = o.p.map((n) => num(n, 0));
    p.length -= p.length % 3;
    const stroke: InkStroke = {
      t: o.t === 'h' ? 'h' : 'p',
      c: typeof o.c === 'string' && COLOR.test(o.c) ? o.c : '#1b1d21',
      w: Math.min(80, Math.max(0.3, num(o.w, 2.4))),
      p,
    };
    if (Array.isArray(o.d) && o.d.length === p.length / 3) stroke.d = o.d.map((n) => Math.max(0, Math.round(num(n, 8))));
    if (typeof o.u === 'number' && o.u > 0 && Number.isFinite(o.u)) stroke.u = o.u;
    s.push(stroke);
  }
  return {
    v: 1,
    w: Math.min(4000, Math.max(100, num(r.w, INK_WIDTH))),
    h: Math.min(20000, Math.max(100, num(r.h, INK_PAGE_HEIGHT))),
    bg: BGS.includes(r.bg as InkBg) ? (r.bg as InkBg) : 'none',
    s,
  };
}

export function isInkEmpty(doc: InkDoc | null | undefined): boolean {
  return !doc || doc.s.length === 0;
}

/** Unterkante aller Striche (Blatteinheiten). */
export function inkBottom(doc: InkDoc): number {
  let max = 0;
  for (const st of doc.s) for (let i = 1; i < st.p.length; i += 3) max = Math.max(max, st.p[i]! + st.w);
  return max;
}

/** Zeichenfläche im Text: auf Inhalt kürzen, aber nie unter die Mindesthöhe. */
export function fitBlockHeight(doc: InkDoc): InkDoc {
  const h = Math.min(INK_BLOCK_MAX_HEIGHT, Math.max(INK_BLOCK_MIN_HEIGHT, Math.ceil(inkBottom(doc) + 60)));
  return { ...doc, h };
}

/** Ein Wert pro Stelle genügt (0,1 Einheiten sind weit unter der Stiftauflösung). */
export function roundInk(doc: InkDoc): InkDoc {
  return {
    ...doc,
    s: doc.s.map((st) => ({
      ...st,
      p: st.p.map((n, i) => (i % 3 === 2 ? Math.round(n * 100) / 100 : Math.round(n * 10) / 10)),
    })),
  };
}
