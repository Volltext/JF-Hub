import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isBlockedAddress } from '../push.js';

/**
 * Der Server verbindet sich im Auftrag der Betreuer mit Mail-Servern, deren Adresse sie selbst eingeben. Ohne Schutz ließe sich so
 * das interne Netz des Servers abtasten (SSRF). Deshalb: nur die üblichen Mail-Ports, nur öffentliche Adressen, und verbunden wird
 * mit der geprüften IP (kein zweiter DNS-Lauf, der auf etwas anderes zeigen könnte). Wer einen Mail-Server im eigenen Netz betreibt,
 * erlaubt das mit `MAIL_ALLOW_PRIVATE=1`.
 */

export class MailHostError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export const IMAP_PORTS = [143, 993];
export const SMTP_PORTS = [25, 465, 587, 2525];

const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Normalisiert Servername oder IP; wirft bei offensichtlich Ungültigem. */
export function cleanHost(v: unknown): string {
  const host = typeof v === 'string' ? v.trim().toLowerCase().replace(/\.$/, '') : '';
  if (isIP(host)) return host;
  if (!HOST_RE.test(host)) throw new MailHostError('Ungültiger Servername');
  return host;
}

export function cleanPort(v: unknown, allowed: number[], what: string): number {
  const port = Number(v);
  if (!Number.isInteger(port) || !allowed.includes(port)) throw new MailHostError(`${what}: Port ${String(v)} ist nicht erlaubt (erlaubt: ${allowed.join(', ')})`);
  return port;
}

export interface Resolved {
  /** Die geprüfte IP-Adresse, mit der verbunden wird. */
  ip: string;
  /** Der Name für die TLS-Prüfung (SNI und Zertifikat). */
  servername: string;
}

export type HostResolver = (host: string) => Promise<{ address: string; family: number }[]>;

const defaultResolver: HostResolver = (host) => lookup(host, { all: true });

/** Löst den Namen auf und liefert eine erlaubte Adresse; wirft, wenn nur interne Adressen herauskommen. */
export async function resolveMailHost(host: string, opts: { allowPrivate?: boolean; resolver?: HostResolver } = {}): Promise<Resolved> {
  const name = cleanHost(host);
  let list: { address: string; family: number }[];
  if (isIP(name)) list = [{ address: name, family: isIP(name) }];
  else {
    try {
      list = await (opts.resolver ?? defaultResolver)(name);
    } catch {
      throw new MailHostError(`Der Server „${name}“ wurde nicht gefunden`);
    }
  }
  const ok = opts.allowPrivate ? list[0] : list.find((a) => !isBlockedAddress(a.address, a.family));
  if (!ok) throw new MailHostError('Dieser Server liegt in einem internen Netz und ist nicht erlaubt (Admin: MAIL_ALLOW_PRIVATE=1)');
  return { ip: ok.address, servername: name };
}
