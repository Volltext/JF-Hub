import webpush from 'web-push';
import { Agent } from 'node:https';
import { BlockList } from 'node:net';
import { lookup as dnsLookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import { getConfig, setConfig } from './db.js';

export type ReminderKind = 'task' | 'service';
const KINDS: ReminderKind[] = ['task', 'service'];

/** Erinnerungen, die älter sind, werden nicht mehr nachgeholt (z. B. nach längerem Serverstillstand). */
const GRACE_MS = 15 * 60_000;
const MAX_PER_KIND = 200;

export class PushError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** VAPID-Schlüssel dieses Servers; werden beim ersten Bedarf erzeugt und in der Datenbank gespeichert. */
export function ensureVapid(db: DatabaseSync): VapidKeys {
  let publicKey = getConfig(db, 'vapidPublic');
  let privateKey = getConfig(db, 'vapidPrivate');
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    setConfig(db, 'vapidPublic', publicKey);
    setConfig(db, 'vapidPrivate', privateKey);
  }
  return { publicKey, privateKey };
}

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Der Server ruft diese Adresse selbst auf – erste Verteidigungslinie gegen Serverseitige Anfragefälschung (SSRF):
 * nur https an einen echten öffentlichen DNS-Namen. Verlangt werden Namenslabels mit Buchstaben-TLD; das schließt
 * IP-Adressen in jeder Schreibweise (dezimal, hexadezimal „0x7f.1“, oktal, IPv4/IPv6) und interne/reservierte Namen aus.
 * DNS-Namen, die auf interne Adressen zeigen, fängt zusätzlich der Adress-Filter beim Verbinden ab (siehe `safeLookup`).
 */
export function checkEndpoint(endpoint: unknown): string {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) throw new PushError('Ungültiges Push-Abonnement');
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new PushError('Ungültiges Push-Abonnement');
  }
  const host = url.hostname.toLowerCase();
  const publicDomain = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
  const reservedSuffix = /\.(local|localhost|internal|intranet|intra|lan|home|corp|test|example|invalid)$/.test(host);
  if (url.protocol !== 'https:' || !publicDomain || reservedSuffix) throw new PushError('Push-Adresse nicht erlaubt');
  return endpoint;
}

/** Private, lokale und sonst reservierte Adressbereiche, die der Server beim Push-Versand nie ansprechen darf. */
const BLOCKED = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [['::1', 128], ['::', 128], ['fc00::', 7], ['fe80::', 10]] as const) {
  BLOCKED.addSubnet(net, bits, 'ipv6');
}
// Hinweis: ::ffff:0:0/96 (IPv4-gemappt) wird bewusst NICHT pauschal geblockt – das träfe jede IPv4-Adresse.
// Gemappte Adressen zerlegt isBlockedAddress und prüft den IPv4-Teil einzeln.

/** true, wenn die IP in einem privaten/lokalen/reservierten Bereich liegt (darf nicht als Push-Ziel dienen). */
export function isBlockedAddress(ip: string, family = ip.includes(':') ? 6 : 4): boolean {
  try {
    if (BLOCKED.check(ip, family === 6 ? 'ipv6' : 'ipv4')) return true;
    // IPv4-gemappte IPv6-Adressen (::ffff:10.0.0.1) zusätzlich als IPv4 prüfen.
    const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
    return m ? BLOCKED.check(m[1]!, 'ipv4') : false;
  } catch {
    return true; // im Zweifel (unparsbare Adresse) blockieren
  }
}

/**
 * DNS-Auflösung für den Push-Versand mit Adress-Filter: schlägt die Verbindung ab, wenn der Name auf eine interne
 * Adresse zeigt (zweite SSRF-Linie, greift auch bei öffentlichen „Resolver-Tricks“ wie *.nip.io und gegen DNS-Rebinding).
 */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  const opts = typeof options === 'number' ? { family: options } : options;
  dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const ok = addresses.find((a) => !isBlockedAddress(a.address, a.family));
    if (!ok) return (callback as (e: Error) => void)(new Error('Push-Ziel zeigt auf eine nicht erlaubte Adresse'));
    callback(null, ok.address, ok.family);
  });
};

export function subscribe(db: DatabaseSync, userId: string, sessionHash: string, sub: BrowserSubscription, device: string): void {
  const endpoint = checkEndpoint(sub?.endpoint);
  const p256dh = sub.keys?.p256dh;
  const auth = sub.keys?.auth;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) throw new PushError('Ungültiges Push-Abonnement');
  // Dasselbe Gerät kann zwischen Nutzern wechseln: das Abonnement gehört dem zuletzt Angemeldeten, alte Erinnerungen entfallen.
  const old = db.prepare('SELECT userId FROM push_subscriptions WHERE endpoint = ?').get(endpoint) as { userId: string } | undefined;
  if (old && old.userId !== userId) db.prepare('DELETE FROM push_reminders WHERE endpoint = ?').run(endpoint);
  db.prepare(
    `INSERT INTO push_subscriptions(endpoint, userId, sessionHash, p256dh, auth, device, createdAt) VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET userId = excluded.userId, sessionHash = excluded.sessionHash, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device`,
  ).run(endpoint, userId, sessionHash, p256dh, auth, device.slice(0, 80), Date.now());
}

export function unsubscribe(db: DatabaseSync, userId: string, endpoint: unknown): void {
  if (typeof endpoint !== 'string') return;
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND userId = ?').run(endpoint, userId);
}

export interface ReminderInput {
  key: string;
  /** Zeitpunkt in ms seit 1970. */
  at: number;
  title: string;
  body: string;
  /** Interner Pfad, der beim Antippen geöffnet wird. */
  url?: string;
}

/** Ersetzt alle Erinnerungen dieser Art für ein Gerät (die App berechnet sie und schickt die nächsten Termine). */
export function replaceReminders(db: DatabaseSync, userId: string, endpoint: unknown, kind: unknown, reminders: unknown): number {
  if (typeof endpoint !== 'string') throw new PushError('Ungültiges Push-Abonnement');
  if (!KINDS.includes(kind as ReminderKind)) throw new PushError('Unbekannte Art');
  if (!Array.isArray(reminders)) throw new PushError('Ungültige Erinnerungen');
  const owner = db.prepare('SELECT userId FROM push_subscriptions WHERE endpoint = ?').get(endpoint) as { userId: string } | undefined;
  if (!owner || owner.userId !== userId) throw new PushError('Gerät nicht für Push angemeldet', 404);
  const now = Date.now();
  const list: ReminderInput[] = [];
  for (const r of reminders as Partial<ReminderInput>[]) {
    if (list.length >= MAX_PER_KIND) break;
    if (typeof r?.key !== 'string' || r.key.length > 64 || typeof r.at !== 'number' || !Number.isFinite(r.at)) continue;
    if (r.at < now - GRACE_MS || r.at > now + 400 * 86_400_000) continue;
    const url = typeof r.url === 'string' && r.url.startsWith('/') && !r.url.startsWith('//') ? r.url.slice(0, 200) : '/';
    list.push({ key: r.key, at: Math.round(r.at), title: String(r.title ?? '').slice(0, 120), body: String(r.body ?? '').slice(0, 300), url });
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM push_reminders WHERE endpoint = ? AND kind = ?').run(endpoint, kind as string);
    const ins = db.prepare('INSERT OR REPLACE INTO push_reminders(endpoint, kind, key, at, title, body, url) VALUES(?,?,?,?,?,?,?)');
    for (const r of list) ins.run(endpoint, kind as string, r.key, r.at, r.title, r.body, r.url ?? '/');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return list.length;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Verschickt eine Nachricht; wirft bei Fehlern ein Objekt mit `statusCode` (wie `web-push`). */
export type PushSender = (sub: BrowserSubscription, payload: PushPayload) => Promise<void>;

export function webPushSender(db: DatabaseSync, subject: string): PushSender {
  const { publicKey, privateKey } = ensureVapid(db);
  webpush.setVapidDetails(subject, publicKey, privateKey);
  // Eigener HTTPS-Agent mit Adress-Filter: verhindert, dass der Versand auf interne Ziele umgeleitet wird (SSRF).
  const agent = new Agent({ lookup: safeLookup });
  return async (sub, payload) => {
    await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600, urgency: 'high', agent });
  };
}

let sending = false;

/** Verschickt alle fälligen Erinnerungen. Abos, die der Push-Dienst nicht mehr kennt (404/410), werden entfernt. */
export async function sendDue(db: DatabaseSync, send: PushSender, now = Date.now()): Promise<{ sent: number; failed: number }> {
  if (sending) return { sent: 0, failed: 0 };
  sending = true;
  try {
    db.prepare('DELETE FROM push_reminders WHERE at < ?').run(now - GRACE_MS);
    const due = db
      .prepare(
        `SELECT r.endpoint, r.kind, r.key, r.title, r.body, r.url, s.p256dh, s.auth
         FROM push_reminders r JOIN push_subscriptions s ON s.endpoint = r.endpoint WHERE r.at <= ? ORDER BY r.at LIMIT 200`,
      )
      .all(now) as { endpoint: string; kind: string; key: string; title: string; body: string; url: string; p256dh: string; auth: string }[];
    let sent = 0;
    let failed = 0;
    for (const r of due) {
      try {
        await send({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, { title: r.title, body: r.body, url: r.url, tag: `${r.kind}:${r.key}` });
        db.prepare('DELETE FROM push_reminders WHERE endpoint = ? AND kind = ? AND key = ?').run(r.endpoint, r.kind, r.key);
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(r.endpoint);
        else if (status !== undefined && status >= 400 && status < 500 && status !== 429) db.prepare('DELETE FROM push_reminders WHERE endpoint = ? AND kind = ? AND key = ?').run(r.endpoint, r.kind, r.key);
        failed++; // sonst: beim nächsten Durchlauf erneut versuchen (bis zum Ablauf der Karenzzeit)
      }
    }
    return { sent, failed };
  } finally {
    sending = false;
  }
}
