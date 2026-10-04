/*
 * Handschrift → SVG (Vorschau im Text, Weboberfläche, PDF).
 * Diese Datei ist absichtlich ohne Importe und steht wortgleich auch im Server (jf-hub-server/src/inkSvg.ts);
 * ein Test (inkSvg.test.ts) schlägt an, wenn beide auseinanderlaufen.
 */

interface SvgStroke {
  t: string;
  c: string;
  w: number;
  p: number[];
}
interface SvgDoc {
  w: number;
  h: number;
  bg: string;
  s: SvgStroke[];
}

export interface InkSvgOptions {
  /** Papierfarbe als Fläche hinter den Strichen (leer = durchsichtig). */
  paper?: string;
  /** Linien/Raster/Punkte des Blatts zeichnen. */
  background?: boolean;
  /** Linienfarbe des Blatts. */
  rule?: string;
  /** Feste Breite/Höhe in das SVG schreiben (für PDF), sonst skaliert es mit dem Container. */
  fixedSize?: boolean;
}

const GRID = 36;
const f = (n: number) => String(Math.round(n * 10) / 10);

function backgroundPath(doc: SvgDoc, rule: string): string {
  if (doc.bg === 'lined') {
    let d = '';
    for (let y = GRID * 2; y < doc.h; y += GRID) d += `M0 ${f(y)}H${f(doc.w)}`;
    return d ? `<path d="${d}" fill="none" stroke="${rule}" stroke-width="1"/>` : '';
  }
  if (doc.bg === 'grid') {
    let d = '';
    for (let y = GRID; y < doc.h; y += GRID) d += `M0 ${f(y)}H${f(doc.w)}`;
    for (let x = GRID; x < doc.w; x += GRID) d += `M${f(x)} 0V${f(doc.h)}`;
    return d ? `<path d="${d}" fill="none" stroke="${rule}" stroke-width="0.8"/>` : '';
  }
  if (doc.bg === 'dots') {
    let d = '';
    for (let y = GRID; y < doc.h; y += GRID) for (let x = GRID; x < doc.w; x += GRID) d += `M${f(x)} ${f(y)}h0.01`;
    return d ? `<path d="${d}" fill="none" stroke="${rule}" stroke-width="3" stroke-linecap="round"/>` : '';
  }
  return '';
}

/** Punkte näher als 0,4 Einheiten zusammenfassen (Rauschen, doppelte Ereignisse). */
function thin(p: number[]): { x: number; y: number; q: number }[] {
  const out: { x: number; y: number; q: number }[] = [];
  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i]!;
    const y = p[i + 1]!;
    const q = p[i + 2]!;
    const last = out[out.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < 0.4) {
      last.q = Math.max(last.q, q);
      continue;
    }
    out.push({ x, y, q });
  }
  return out;
}

function dot(x: number, y: number, r: number): string {
  return `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
}

/** Stift: Umriss mit druckabhängiger Breite, Linien über Mittelpunkte geglättet, runde Enden. */
function penPath(p: number[], w: number): string {
  const pts = thin(p);
  const n = pts.length;
  if (n === 0) return '';
  const base = w / 2;
  if (n === 1) return dot(pts[0]!.x, pts[0]!.y, base);

  // Radius je Punkt, leicht geglättet.
  const raw = pts.map((a) => base * (0.55 + 0.9 * Math.min(1, Math.max(0, a.q))));
  const rad = raw.map((_, i) => {
    const a = raw[Math.max(0, i - 1)]!;
    const b = raw[i]!;
    const c = raw[Math.min(n - 1, i + 1)]!;
    return (a + 2 * b + c) / 4;
  });

  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(n - 1, i + 1)]!;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const r = rad[i]!;
    left.push([pts[i]!.x - dy * r, pts[i]!.y + dx * r]);
    right.push([pts[i]!.x + dy * r, pts[i]!.y - dx * r]);
  }

  const mid = (a: [number, number], b: [number, number]) => `${f((a[0] + b[0]) / 2)} ${f((a[1] + b[1]) / 2)}`;
  const at = (a: [number, number]) => `${f(a[0])} ${f(a[1])}`;
  let d = `M${at(left[0]!)}`;
  for (let i = 1; i < n; i++) d += `Q${at(left[i - 1]!)} ${mid(left[i - 1]!, left[i]!)}`;
  d += `L${at(left[n - 1]!)}A${f(rad[n - 1]!)} ${f(rad[n - 1]!)} 0 0 0 ${at(right[n - 1]!)}`;
  for (let i = n - 1; i >= 1; i--) d += `Q${at(right[i]!)} ${mid(right[i]!, right[i - 1]!)}`;
  d += `L${at(right[0]!)}A${f(rad[0]!)} ${f(rad[0]!)} 0 0 0 ${at(left[0]!)}Z`;
  return d;
}

function markerPath(p: number[]): string {
  const pts = thin(p);
  if (pts.length < 2) return '';
  let d = `M${f(pts[0]!.x)} ${f(pts[0]!.y)}`;
  for (let i = 1; i < pts.length; i++) d += `L${f(pts[i]!.x)} ${f(pts[i]!.y)}`;
  return d;
}

const esc = (s: string) => s.replace(/[^#0-9a-zA-Z]/g, '');

/** Ganze Zeichenfläche als SVG-Text. Textmarker liegen unter der Schrift, damit sie nichts verdecken. */
export function inkSvg(doc: SvgDoc, opts: InkSvgOptions = {}): string {
  const parts: string[] = [];
  if (opts.paper) parts.push(`<rect width="${f(doc.w)}" height="${f(doc.h)}" fill="${esc(opts.paper)}"/>`);
  if (opts.background !== false) parts.push(backgroundPath(doc, esc(opts.rule ?? '#d5dae2')));

  for (const st of doc.s) {
    if (st.t !== 'h') continue;
    const d = markerPath(st.p);
    if (d) parts.push(`<path d="${d}" fill="none" stroke="${esc(st.c)}" stroke-opacity="0.38" stroke-width="${f(st.w)}" stroke-linejoin="round"/>`);
  }
  for (const st of doc.s) {
    if (st.t === 'h') continue;
    const d = penPath(st.p, st.w);
    if (d) parts.push(`<path d="${d}" fill="${esc(st.c)}"/>`);
  }

  const size = opts.fixedSize ? ` width="${f(doc.w)}" height="${f(doc.h)}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(doc.w)} ${f(doc.h)}"${size}>${parts.join('')}</svg>`;
}
