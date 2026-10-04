import type { KnotGuide, PositionGuide, RuleEntry } from './types';

/** Kleinschreibung, Umlaute als ae/oe/ue/ss – so findet „übertreten“ auch „uebertreten“ und umgekehrt. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Alle Suchwörter müssen vorkommen (UND-Suche); leere Suche trifft alles. */
export function matches(query: string, ...fields: (string | string[])[]): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize(fields.flat().join(' '));
  return words.every((w) => haystack.includes(w));
}

export const searchRules = (list: RuleEntry[], q: string) =>
  list.filter((r) => matches(q, r.title, r.category, r.keywords, r.summary, r.details));

export const searchPositions = (list: PositionGuide[], q: string) =>
  list.filter((p) => matches(q, p.title, p.shortLabel, p.section, p.duties, p.watchouts));

export const searchKnots = (list: KnotGuide[], q: string) =>
  list.filter((k) => matches(q, k.title, k.category, k.steps));
