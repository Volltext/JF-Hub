/**
 * Autokorrektur beim Schreiben, wie man sie aus Textprogrammen kennt – ohne Wörterbuch, ohne Netz, nur mit festen, vorsichtigen Regeln.
 * Gedacht für das Tippen mit echter Tastatur (Tablet mit Tastatur, Laptop), wo die Bildschirmtastatur mit ihren Vorschlägen fehlt.
 *
 * Alles hier sind reine Funktionen: Sie bekommen den Text des Absatzes bis zum Cursor (einschließlich des gerade getippten Zeichens)
 * und sagen, welches Ende davon wodurch ersetzt werden soll. Den Editor bindet `autocorrectExtension.ts` an.
 *
 * Regeln:
 * - Satzanfang groß („heute war …“ → „Heute war …“), nicht nach Abkürzungen („z. B.“, „ca.“) und Ordnungszahlen („3. Mai“).
 * - ZWei Großbuchstaben am Wortanfang („DIenst“ → „Dienst“), nicht bei Abkürzungen wie „JFler“.
 * - Häufige Tippfehler („udn“ → „und“, „nciht“ → „nicht“, „vieleicht“ → „vielleicht“).
 * - Typografie: deutsche Anführungszeichen „…“, Gedankenstrich „ – “ zwischen Wörtern, Auslassungspunkte „…“.
 *
 * Korrigiert wird erst, wenn ein Wort fertig ist (Leerzeichen, Satzzeichen, Zeilenende). Mit der Rücktaste direkt danach ist die
 * Korrektur zurückgenommen (übernimmt der Editor).
 */

export interface Correction {
  /** Wie viele Zeichen am Ende des Textes ersetzt werden. */
  length: number;
  /** Was stattdessen dort steht. */
  text: string;
}

/** Zeichen, die ein Wort beenden: Danach wird das Wort geprüft. */
const WORD_END = /[\s.,;:!?)\]}"“”»…]/u;
const LETTERS = /\p{L}+$/u;
const LOWER = /^\p{Ll}+$/u;

/**
 * Häufige Tippfehler: vertauschte oder fehlende Buchstaben in sehr häufigen Wörtern und typische Falschschreibungen.
 * Aufgenommen wird nur, was selbst kein deutsches Wort ist – sonst würde die Korrektur richtige Texte verderben.
 * Schlüssel klein; Großschreibung am Wortanfang bleibt erhalten, Substantive stehen mit großem Anfangsbuchstaben im Ziel.
 */
export const TYPOS: Readonly<Record<string, string>> = {
  udn: 'und',
  nud: 'und',
  nciht: 'nicht',
  nihct: 'nicht',
  nicth: 'nicht',
  ncht: 'nicht',
  ihc: 'ich',
  cih: 'ich',
  auhc: 'auch',
  acuh: 'auch',
  uach: 'auch',
  mti: 'mit',
  dsa: 'das',
  dei: 'die',
  dme: 'dem',
  dne: 'den',
  eien: 'eine',
  enie: 'eine',
  iene: 'eine',
  ien: 'ein',
  sihc: 'sich',
  scih: 'sich',
  ncoh: 'noch',
  nohc: 'noch',
  shcon: 'schon',
  scohn: 'schon',
  wnen: 'wenn',
  wiel: 'weil',
  wrude: 'wurde',
  wudre: 'wurde',
  wruden: 'wurden',
  wudren: 'wurden',
  wreden: 'werden',
  wedren: 'werden',
  wrid: 'wird',
  widr: 'wird',
  habne: 'haben',
  ahben: 'haben',
  abre: 'aber',
  aebr: 'aber',
  oedr: 'oder',
  odre: 'oder',
  üebr: 'über',
  zmu: 'zum',
  zru: 'zur',
  vno: 'von',
  vmo: 'vom',
  afu: 'auf',
  uaf: 'auf',
  snid: 'sind',
  sidn: 'sind',
  jtezt: 'jetzt',
  jeztt: 'jetzt',
  dsas: 'dass',
  vieleicht: 'vielleicht',
  vileicht: 'vielleicht',
  vielelicht: 'vielleicht',
  eigendlich: 'eigentlich',
  warscheinlich: 'wahrscheinlich',
  zimlich: 'ziemlich',
  nähmlich: 'nämlich',
  interresant: 'interessant',
  intressant: 'interessant',
  standart: 'Standard',
  rythmus: 'Rhythmus',
  reperatur: 'Reparatur',
  maschiene: 'Maschine',
  feurwehr: 'Feuerwehr',
  feuerwher: 'Feuerwehr',
  feuewehr: 'Feuerwehr',
  jugendfeurwehr: 'Jugendfeuerwehr',
  jugendfeuerwher: 'Jugendfeuerwehr',
  betruer: 'Betreuer',
  bertreuer: 'Betreuer',
  übnug: 'Übung',
  deinst: 'Dienst',
  dienstabned: 'Dienstabend',
  gerätehuas: 'Gerätehaus',
  gerätehasu: 'Gerätehaus',
  jugendlcihe: 'Jugendliche',
  jugendlcihen: 'Jugendlichen',
  kidner: 'Kinder',
};

/**
 * Abkürzungen mit Punkt, nach denen kein neuer Satz beginnt („bzw. die“, „ca. zehn“), klein geschrieben. Mehrteilige wie „z. B.“
 * erkennt `isSentenceStart` ohne Liste. Wörter, die auch am Satzende stehen („so“, „Art“, „Max“), fehlen absichtlich.
 */
const ABBREVIATIONS = new Set([
  'mfg', 'ggf', 'evtl', 'bzw', 'ca', 'usw', 'etc', 'inkl', 'exkl', 'zzgl', 'vgl', 'bspw',
  'sog', 'nr', 'str', 'hr', 'fr', 'dr', 'prof', 'std', 'min', 'sek', 'mio', 'mrd', 'tsd', 'mo', 'di', 'mi', 'do', 'sa', 'jan', 'feb',
  'mär', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'okt', 'nov', 'dez', 'abs', 'kap', 'anm', 'tel', 'gem', 'lt', 'mind',
  'ggü', 'allg', 'abt', 'ehem', 'gegr', 'urspr', 'jh', 'jhd', 'od', 'bzgl', 'zw', 'ff', 'ebd', 'vs', 'hl', 'kl', 'gr',
  'stv', 'kdt', 'hbm', 'obm', 'bm', 'lm', 'olm', 'hlm', 'fm', 'ofm', 'hfm', 'uvm', 'insb', 'ugs', 'ausg', 'betr', 'bez',
]);

/**
 * Zwei Großbuchstaben am Anfang sind hier meist gewollt: Abkürzungen der Feuerwehr und Alltagswörter („JFler“, „FFlerin“, „PCs“).
 * Für diese Anfänge bleibt das Wort, wie es ist.
 */
const TWO_CAPS_OK = new Set([
  'JF', 'FF', 'BF', 'WF', 'GW', 'LF', 'HL', 'TL', 'MT', 'EL', 'DL', 'RW', 'KD', 'PC', 'TV', 'DJ', 'PA', 'AG', 'LK', 'SB', 'IT', 'UV', 'EU',
  'US', 'UK', 'KF', 'TH', 'SG', 'VR', 'AB', 'DB', 'BW', 'NR', 'ID', 'CD', 'DV', 'FW', 'JW', 'KJ',
]);

const OPENERS = /[\s([{„“‚‘«»/–—-]/u;

/** Großschreibung des ersten Buchstabens, ohne „ß“ in „SS“ zu verwandeln. */
function capitalize(word: string): string {
  const first = word[0]!;
  const up = first.toLocaleUpperCase('de-DE');
  return (up.length === 1 ? up : first) + word.slice(1);
}

/** Beginnt hinter `before` (dem Text vor dem Wort) ein neuer Satz? */
export function isSentenceStart(before: string): boolean {
  // Öffnende Anführungszeichen und Klammern direkt vor dem Wort gehören zum Satzanfang.
  const open = before.replace(/[„“‚‘«»"'([{]+$/u, '');
  const trimmed = open.trimEnd();
  // Absatzanfang oder neue Zeile im Absatz (Umschalt+Enter).
  if (!trimmed || /\n[^\S\n]*$/u.test(open)) return true;
  // Zwischen Satzzeichen und Wort muss Platz sein (sonst wäre es „www.beispiel“); schließende Zeichen dürfen dem Satzzeichen folgen.
  if (trimmed === open) return false;
  const m = /([.!?…])["“”»)\]]*$/u.exec(trimmed);
  if (!m) return false;
  if (m[1] !== '.') return true;
  // Punkt: kein Satzende nach Zahlen („3. Mai“), einzelnen Buchstaben („a. d.“) und bekannten Abkürzungen („z. B.“, „ca.“).
  const token = /[\p{L}\p{N}.]*$/u.exec(trimmed.slice(0, m.index))?.[0] ?? '';
  if (!token) return true;
  if (/\p{N}$/u.test(token)) return false;
  // Mehrteilige Abkürzungen: „z.B.“, „u.a.“ (mit Punkt im Wort) und „z. B.“, „d. h.“ (einzelner Buchstabe vor dem Punkt).
  if (token.includes('.') || token.length <= 1) return false;
  return !ABBREVIATIONS.has(token.toLocaleLowerCase('de-DE'));
}

/** Korrektur eines gerade beendeten Wortes, oder `null`. */
export function correctWord(word: string, before: string): string | null {
  let out = word;
  const lower = word.toLocaleLowerCase('de-DE');
  const typo = TYPOS[lower];
  if (typo && (LOWER.test(word) || word === capitalize(lower))) {
    out = /^\p{Lu}/u.test(typo) || word !== lower ? capitalize(typo) : typo;
  } else if (/^\p{Lu}{2}\p{Ll}{2,}$/u.test(word) && !TWO_CAPS_OK.has(word.slice(0, 2))) {
    out = word[0] + word[1]!.toLocaleLowerCase('de-DE') + word.slice(2);
  }
  if (LOWER.test(out) && isSentenceStart(before)) out = capitalize(out);
  return out === word ? null : out;
}

/**
 * Prüft den Text bis zum Cursor nach dem Tippen eines Zeichens. `text` endet mit dem getippten Zeichen; beim Zeilenende (Enter)
 * ist es der Text ohne Zeilenumbruch und `atLineEnd` gesetzt.
 */
export function autocorrect(text: string, atLineEnd = false): Correction | null {
  if (!text) return null;
  const typed = atLineEnd ? '' : text[text.length - 1]!;
  const head = atLineEnd ? text : text.slice(0, -1);

  let typedOut = typed;
  if (typed === '"') {
    // Öffnend am Anfang, nach Leerzeichen und öffnenden Zeichen, sonst schließend (dann wird auch das Wort davor geprüft).
    const prev = head[head.length - 1];
    if (prev === undefined || OPENERS.test(prev)) return { length: 1, text: '„' };
    typedOut = '“';
  }
  if (typed === '.' && head.endsWith('..') && !head.endsWith('...')) return { length: 3, text: '…' };
  if (typed === ' ') {
    // Gedankenstrich zwischen Wörtern: „Punkt 1 - Begrüßung“, „Punkt 1 -- Begrüßung“. Nie am Zeilenanfang (das wird eine Aufzählung).
    const dash = /(?<=[^\s-]) (--?) $/u.exec(text);
    if (dash) return { length: dash[1]!.length + 1, text: '– ' };
  }

  if (!atLineEnd && !WORD_END.test(typed)) return null;
  const quoteOnly: Correction | null = typedOut !== typed ? { length: 1, text: typedOut } : null;
  const word = LETTERS.exec(head)?.[0];
  if (!word) return quoteOnly;
  const before = head.slice(0, head.length - word.length);
  const prev = before[before.length - 1];
  // Nur ganze Wörter: nicht in Adressen, Zahlen, #Tags, @Namen, Wortverbindungen („E-Mail“) oder Dateinamen.
  if (prev !== undefined && !OPENERS.test(prev)) return quoteOnly;
  if ((prev === '-' || prev === '/' || prev === '–' || prev === '—') && before.length > 1 && !/\s$/u.test(before.slice(0, -1))) return quoteOnly;
  const fixed = correctWord(word, before);
  if (!fixed) return quoteOnly;
  return { length: word.length + typed.length, text: fixed + typedOut };
}
