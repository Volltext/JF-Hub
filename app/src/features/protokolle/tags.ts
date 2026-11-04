/**
 * #Tags im Text, wie bei Bear: Ein Tag ist ein „#“ direkt vor einem Wort mit mindestens einem Buchstaben („#Dienstabend“, „#2026/Lager“).
 * Sie stehen als gewöhnlicher Text im Dokument, es gibt keine eigene Struktur: Alte Apps, Suche, PDF und Abgleich bleiben unberührt.
 * „#3“ (Nummer) und „# Titel“ (Überschrift) sind keine Tags; vor dem „#“ steht Anfang, Leerraum oder eine öffnende Klammer.
 */
export const TAG_SOURCE = String.raw`(?<![\p{L}\p{N}_/#&])#((?=[\p{L}\p{N}_/-]*\p{L})[\p{L}\p{N}_/-]+)`;

/** Alle Tags eines Textes (ohne „#“), ohne Doppelte (Groß-/Kleinschreibung egal, die erste Schreibweise gewinnt), in der Reihenfolge des Auftretens. */
export function extractTags(text: string): string[] {
  const seen = new Map<string, string>();
  for (const m of text.matchAll(new RegExp(TAG_SOURCE, 'gu'))) {
    const tag = m[1]!.replace(/[-/]+$/, '');
    if (tag && !seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  }
  return [...seen.values()];
}

/** Passt `tag` auf den gewählten Filter? „Dienst“ trifft auch „Dienst/Knoten“ (Unterthemen), nicht aber „Dienstplan“. */
export function tagMatches(tag: string, filter: string): boolean {
  const t = tag.toLowerCase();
  const f = filter.toLowerCase();
  return t === f || t.startsWith(`${f}/`);
}

/** Text ohne Tags für die Vorschau in der Liste (die Tags stehen dort als eigene Schilder). */
export function stripTags(text: string): string {
  return text.replace(new RegExp(TAG_SOURCE, 'gu'), '').replace(/[ \t]{2,}/g, ' ');
}
