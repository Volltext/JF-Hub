import type { DatabaseSync } from 'node:sqlite';
import { decryptSecret, encryptSecret } from './crypto.js';
import { cleanHost, cleanPort, IMAP_PORTS, MailHostError, SMTP_PORTS } from './hosts.js';
import { MailInputError } from './errors.js';
import { isEmail, oneLine } from './text.js';
import type { MailConnection } from './types.js';

export interface MailAccountRow {
  userId: string;
  email: string;
  displayName: string;
  username: string;
  passEnc: string;
  imapHost: string;
  imapPort: number;
  imapSecure: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: number;
  notify: number;
  uidValidity: number | null;
  lastUid: number | null;
  checkedAt: number | null;
  failures: number;
  lastError: string;
  createdAt: number;
}

/** Was die App von einem Postfach erfährt: alles außer dem Passwort. */
export interface PublicMailAccount {
  email: string;
  displayName: string;
  username: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  notify: boolean;
  lastError: string;
}

export { MailInputError };

export const publicAccount = (r: MailAccountRow): PublicMailAccount => ({
  email: r.email,
  displayName: r.displayName,
  username: r.username,
  imapHost: r.imapHost,
  imapPort: r.imapPort,
  imapSecure: r.imapSecure === 1,
  smtpHost: r.smtpHost,
  smtpPort: r.smtpPort,
  smtpSecure: r.smtpSecure === 1,
  notify: r.notify === 1,
  lastError: r.lastError,
});

export function getAccount(db: DatabaseSync, userId: string): MailAccountRow | undefined {
  return db.prepare('SELECT * FROM mail_accounts WHERE userId = ?').get(userId) as MailAccountRow | undefined;
}

export function toConnection(key: Buffer, row: MailAccountRow): MailConnection {
  return {
    email: row.email,
    username: row.username,
    password: decryptSecret(key, row.passEnc),
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    imapSecure: row.imapSecure === 1,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure === 1,
  };
}

export interface AccountInput {
  email: string;
  displayName: string;
  username: string;
  /** Leer beim Ändern = Passwort behalten. */
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  notify: boolean;
}

/** Prüft die Eingaben der App. Ändert nichts in der Datenbank. `existing` liefert das bisherige Passwort, wenn keines mitkommt. */
export function parseAccountInput(body: unknown, existing: { password: string } | undefined): AccountInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const email = oneLine(String(b.email ?? '')).toLowerCase();
  if (!isEmail(email)) throw new MailInputError('Bitte eine gültige E-Mail-Adresse eintragen.');
  const password = typeof b.password === 'string' ? b.password : '';
  if (!password && !existing) throw new MailInputError('Bitte das Passwort eintragen.');
  if (password.length > 500) throw new MailInputError('Das Passwort ist zu lang.');
  try {
    const imapPort = cleanPort(b.imapPort, IMAP_PORTS, 'IMAP');
    const smtpPort = cleanPort(b.smtpPort, SMTP_PORTS, 'SMTP');
    return {
      email,
      displayName: oneLine(String(b.displayName ?? '')).slice(0, 100),
      username: oneLine(String(b.username ?? '')) || email,
      password: password || existing!.password,
      imapHost: cleanHost(b.imapHost),
      imapPort,
      // Port 993 und 465 sprechen von Anfang an TLS, 143 und 587 starten unverschlüsselt und wechseln per STARTTLS (wird erzwungen).
      imapSecure: imapPort === 993,
      smtpHost: cleanHost(b.smtpHost),
      smtpPort,
      smtpSecure: smtpPort === 465,
      notify: b.notify !== false,
    };
  } catch (e) {
    if (e instanceof MailHostError) throw new MailInputError(e.message);
    throw e;
  }
}

export function saveAccount(db: DatabaseSync, key: Buffer, userId: string, input: AccountInput): void {
  const passEnc = encryptSecret(key, input.password);
  db.prepare(
    `INSERT INTO mail_accounts(userId, email, displayName, username, passEnc, imapHost, imapPort, imapSecure, smtpHost, smtpPort, smtpSecure, notify, createdAt)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(userId) DO UPDATE SET email = excluded.email, displayName = excluded.displayName, username = excluded.username, passEnc = excluded.passEnc,
       imapHost = excluded.imapHost, imapPort = excluded.imapPort, imapSecure = excluded.imapSecure, smtpHost = excluded.smtpHost, smtpPort = excluded.smtpPort,
       smtpSecure = excluded.smtpSecure, notify = excluded.notify, uidValidity = NULL, lastUid = NULL, checkedAt = NULL, failures = 0, lastError = ''`,
  ).run(userId, input.email, input.displayName, input.username, passEnc, input.imapHost, input.imapPort, input.imapSecure ? 1 : 0, input.smtpHost, input.smtpPort, input.smtpSecure ? 1 : 0, input.notify ? 1 : 0, Date.now());
}

export function deleteAccount(db: DatabaseSync, userId: string): boolean {
  return db.prepare('DELETE FROM mail_accounts WHERE userId = ?').run(userId).changes > 0;
}

export function setNotify(db: DatabaseSync, userId: string, notify: boolean): boolean {
  return db.prepare('UPDATE mail_accounts SET notify = ? WHERE userId = ?').run(notify ? 1 : 0, userId).changes > 0;
}
