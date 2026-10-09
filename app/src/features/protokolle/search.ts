import type { JSONContent } from '@tiptap/core';

/** Reintext eines TipTap-Dokuments; Absätze, Überschriften und Listenpunkte werden durch Zeilenumbrüche getrennt. */
export function extractText(node: JSONContent | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  // Anhänge: nur Beschriftung bzw. Dateiname sind durchsuchbar, nie die Daten.
  if (node.type === 'photo') return String(node.attrs?.caption ?? '');
  if (node.type === 'attachment') return String(node.attrs?.name ?? '');
  // Tabellen: eine Zeile je Tabellenzeile, die Zellen mit „ · “ getrennt (Absätze innerhalb einer Zelle bleiben in der Zeile), leere entfallen.
  if (node.type === 'tableRow') {
    return (node.content ?? [])
      .map((cell) => extractText(cell).replace(/\s*\n\s*/g, ' ').trim())
      .filter(Boolean)
      .join(' · ');
  }
  if (node.type === 'table') return (node.content ?? []).map(extractText).filter(Boolean).join('\n');
  const inner = (node.content ?? []).map(extractText);
  // Block-Kinder (Absätze, Listenpunkte …) mit Zeilenumbruch trennen, Inline-Kinder direkt aneinanderfügen.
  return node.content?.some((c) => c.type !== 'text' && c.type !== 'hardBreak') ? inner.join('\n') : inner.join('');
}

/** Klein schreiben und Akzente entfernen („Ä“ → „a“), Länge bleibt Zeichen für Zeichen erhalten. */
export function fold(s: string): string {
  let out = '';
  for (const ch of s) {
    const base = ch.normalize('NFD')[0]!.toLowerCase();
    out += base.length === ch.length ? base : ch;
  }
  return out;
}

export interface SearchItem {
  id: string;
  title: string;
  ort: string;
  leitung: string;
  text: string;
}

export interface Snippet {
  parts: { text: string; hit: boolean }[];
}

export interface SearchHit {
  id: string;
  score: number;
  snippet: Snippet | null;
}

export function searchTerms(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

function makeSnippet(text: string, folded: string, terms: string[]): Snippet | null {
  let first = -1;
  for (const t of terms) {
    const i = folded.indexOf(t);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  if (first < 0) return null;
  const start = Math.max(0, first - 50);
  const end = Math.min(text.length, first + 110);
  const slice = text.slice(start, end);
  const fslice = folded.slice(start, end);
  // Treffer markieren (alle Suchwörter, überlappungsfrei).
  const marks: [number, number][] = [];
  for (const t of terms) {
    for (let i = fslice.indexOf(t); i >= 0; i = fslice.indexOf(t, i + t.length)) marks.push([i, i + t.length]);
  }
  marks.sort((a, b) => a[0] - b[0]);
  const parts: Snippet['parts'] = [];
  let pos = 0;
  const clean = (s: string) => s.replace(/\s*\n\s*/g, ' ');
  for (const [a, b] of marks) {
    if (b <= pos) continue;
    const from = Math.max(a, pos);
    if (from > pos) parts.push({ text: clean(slice.slice(pos, from)), hit: false });
    parts.push({ text: clean(slice.slice(from, b)), hit: true });
    pos = b;
  }
  if (pos < slice.length) parts.push({ text: clean(slice.slice(pos)), hit: false });
  if (start > 0) parts.unshift({ text: '… ', hit: false });
  if (end < text.length) parts.push({ text: ' …', hit: false });
  return { parts };
}

/** Volltextsuche: alle Suchwörter müssen vorkommen (Titel, Ort, Protokollführung oder Text), Groß-/Kleinschreibung und Umlaute egal. */
export function searchProtocols(items: SearchItem[], query: string): SearchHit[] {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  for (const it of items) {
    const title = fold(it.title);
    const meta = fold(`${it.ort}\n${it.leitung}`);
    const body = fold(it.text);
    const all = `${title}\n${meta}\n${body}`;
    if (!terms.every((t) => all.includes(t))) continue;
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 10;
      if (meta.includes(t)) score += 3;
      for (let i = body.indexOf(t); i >= 0 && score < 1000; i = body.indexOf(t, i + t.length)) score += 1;
    }
    hits.push({ id: it.id, score, snippet: makeSnippet(it.text, body, terms) });
  }
  return hits.sort((a, b) => b.score - a.score);
}
