import { MailInputError } from './errors.js';
import type { MailAddress } from './types.js';

/** Hilfen ohne Netz: Text aus HTML, Adressen, Ordnerarten. Getrennt von `imap.ts`, damit sie sich testen lassen. */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', euro: '€', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/**
 * Macht aus einer HTML-Mail lesbaren Text. Es wird nie HTML angezeigt: So laufen keine Skripte, und Bilder und Tracking-Pixel
 * werden nicht nachgeladen (sonst wüsste der Absender, wann und wo die Mail geöffnet wurde).
 */
export function htmlToText(html: string): string {
  let t = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]*>/g, '').trim();
      return /^https?:\/\//i.test(href) && text && text !== href ? `${text} (${href})` : text || href;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table|blockquote)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(/<[^>]*>/g, '');
  t = decodeEntities(t);
  return t
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Entfernt Zeilenumbrüche und Steuerzeichen (Schutz vor eingeschleusten Kopfzeilen, etwa im Betreff). */
// eslint-disable-next-line no-control-regex
export const oneLine = (s: string): string => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();

const ADDRESS = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]{2,}$/;
export const isEmail = (s: string): boolean => s.length <= 254 && ADDRESS.test(s);

/** Trennt bei Komma, Semikolon und Zeilenumbruch, aber nicht innerhalb von Anführungszeichen („Müller, Anna“ <a@x.de>). */
function splitAddresses(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === ',' || ch === ';' || ch === '\n')) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** „Max <max@x.de>, anna@y.de“ → Liste. Wirft bei ungültigen Adressen (Fehlermeldung nennt die Adresse). */
export function parseAddressList(input: unknown, limit = 30): MailAddress[] {
  if (input === undefined || input === null || input === '') return [];
  const parts = Array.isArray(input) ? input.map(String) : splitAddresses(String(input));
  const out: MailAddress[] = [];
  for (const raw of parts) {
    const part = oneLine(raw);
    if (!part) continue;
    const m = /^(.*?)<([^<>]+)>$/.exec(part);
    const address = (m ? m[2]! : part).trim();
    if (!isEmail(address)) throw new MailInputError(`Ungültige E-Mail-Adresse: ${part.slice(0, 80)}`);
    const name = m ? m[1]!.trim().replace(/^"|"$/g, '').slice(0, 100) : '';
    out.push({ name, address });
    if (out.length > limit) throw new MailInputError(`Zu viele Empfänger (höchstens ${limit})`);
  }
  return out;
}

export function toAddress(a: { name?: string | undefined; address?: string | undefined } | undefined | null): MailAddress | null {
  if (!a?.address) return null;
  return { name: oneLine(a.name ?? ''), address: a.address };
}

export const toAddresses = (list: { name?: string | undefined; address?: string | undefined }[] | undefined | null): MailAddress[] =>
  (list ?? []).map(toAddress).filter((a): a is MailAddress => a !== null);

/** Kurzform für Benachrichtigungen und Listen: Name, sonst Adresse. */
export const displayAddress = (a: MailAddress | null): string => (a ? a.name || a.address : 'Unbekannt');

const SPECIAL: Record<string, string> = { '\\Sent': 'sent', '\\Drafts': 'drafts', '\\Trash': 'trash', '\\Junk': 'junk', '\\Archive': 'archive', '\\All': 'archive', '\\Flagged': '' };

/** Art eines Ordners aus dem Special-Use-Merkmal; der Posteingang ist am Namen zu erkennen. */
export function folderKind(path: string, specialUse?: string): string {
  if (path.toUpperCase() === 'INBOX') return 'inbox';
  return (specialUse && SPECIAL[specialUse]) || '';
}

const KIND_ORDER = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash', ''];
export const folderRank = (kind: string): number => KIND_ORDER.indexOf(kind);

/** „Re: “ nur einmal voranstellen (auch „AW:“ zählt). */
export function replySubject(subject: string): string {
  return /^\s*(re|aw)\s*:/i.test(subject) ? subject : `Re: ${subject}`;
}

export function forwardSubject(subject: string): string {
  return /^\s*(fwd?|wg)\s*:/i.test(subject) ? subject : `Fwd: ${subject}`;
}
