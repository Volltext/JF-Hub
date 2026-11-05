import type { MailAddress, MailMessage } from './api';

/** Reine Hilfen zum Schreiben: Adressen, Antworten, Weiterleiten. Ohne Oberfläche, damit sie sich testen lassen. */

export const formatAddress = (a: MailAddress): string => {
  const name = a.name.trim();
  if (!name) return a.address;
  // Namen mit Satzzeichen, die Adresslisten trennen, gehören in Anführungszeichen.
  return /[,;"<>]/.test(name) ? `"${name.replace(/"/g, '')}" <${a.address}>` : `${name} <${a.address}>`;
};

export const addressList = (list: MailAddress[]): string => list.map(formatAddress).join(', ');

/** Kurzform für Listen: Name, sonst Adresse. */
export const shortAddress = (a: MailAddress | null | undefined): string => (a ? a.name.trim() || a.address : 'Unbekannt');

/**
 * Empfänger in einer Zeile für den Kopf einer Mail: die ersten Namen, dann „und 12 weitere“. So bleibt eine Rundmail mit Dutzenden
 * Empfängern eine Zeile; die volle Liste steht eingeklappt dahinter.
 */
export function recipientSummary(to: MailAddress[], cc: MailAddress[] = [], show = 2): string {
  const all = [...to, ...cc];
  if (all.length <= show + 1) return all.map(shortAddress).join(', ');
  return `${all.slice(0, show).map(shortAddress).join(', ')} und ${all.length - show} weitere`;
}

export function replySubject(subject: string): string {
  return /^\s*(re|aw)\s*:/i.test(subject) ? subject : `Re: ${subject}`;
}

export function forwardSubject(subject: string): string {
  return /^\s*(fwd?|wg)\s*:/i.test(subject) ? subject : `Fwd: ${subject}`;
}

/** Datum und Uhrzeit für Kopf und Zitat („03.11.2026, 14:30“). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Zitiert einen Text mit „> “ vor jeder Zeile. */
export const quote = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .trimEnd()
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n');

export interface Draft {
  to: string;
  cc: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
}

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Antwort auf eine Mail. „Allen antworten“ nimmt alle anderen Empfänger mit, aber nie die eigene Adresse. Bei einer Antwort an den
 * Absender gilt „Antwort an“ (Reply-To), wenn die Mail eines setzt (Verteiler, Vereinspostfächer).
 */
export function buildReply(msg: MailMessage, opts: { all: boolean; me: string }): Draft {
  const primary = msg.replyTo[0] ?? msg.from;
  const to = primary && !sameAddress(primary.address, opts.me) ? [primary] : msg.to.filter((a) => !sameAddress(a.address, opts.me)).slice(0, 1);
  const cc: MailAddress[] = [];
  if (opts.all) {
    for (const a of [...msg.to, ...msg.cc]) {
      if (sameAddress(a.address, opts.me) || [...to, ...cc].some((x) => sameAddress(x.address, a.address))) continue;
      cc.push(a);
    }
  }
  const who = msg.from ? formatAddress(msg.from) : 'Unbekannt';
  const when = formatDateTime(msg.date);
  return {
    to: addressList(to),
    cc: addressList(cc),
    subject: replySubject(msg.subject),
    text: `\n\n${when ? `Am ${when} schrieb ${who}:` : `${who} schrieb:`}\n${quote(msg.text)}\n`,
    inReplyTo: msg.messageId || undefined,
    references: msg.messageId ? [...msg.references, msg.messageId] : msg.references,
  };
}

/** Weiterleiten: der Text der Mail mit Kopfzeilen. Anhänge hängt die Oberfläche auf Wunsch an. */
export function buildForward(msg: MailMessage): Draft {
  const lines = [
    '---------- Weitergeleitete Nachricht ----------',
    `Von: ${msg.from ? formatAddress(msg.from) : 'Unbekannt'}`,
    `Datum: ${formatDateTime(msg.date)}`,
    `Betreff: ${msg.subject}`,
    `An: ${addressList(msg.to)}`,
    ...(msg.cc.length ? [`Cc: ${addressList(msg.cc)}`] : []),
  ];
  return { to: '', cc: '', subject: forwardSubject(msg.subject), text: `\n\n${lines.join('\n')}\n\n${msg.text}\n` };
}

/** Eine neue Mail mit einem Protokoll im Anhang: Betreff und Anrede sind vorbereitet. */
export function buildProtocolMail(title: string, datum: string): Draft {
  const when = datum ? ` vom ${datum.split('-').reverse().join('.')}` : '';
  return { to: '', cc: '', subject: `Protokoll${when}${title ? `: ${title}` : ''}`, text: 'Hallo zusammen,\n\nanbei das Protokoll.\n\nViele Grüße\n' };
}

/** Grobe Prüfung auf eine Adresse, bevor man den Server fragt (der prüft streng). */
export const looksLikeEmail = (s: string): boolean => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(s.trim());
