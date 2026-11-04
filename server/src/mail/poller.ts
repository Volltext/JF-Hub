import type { DatabaseSync } from 'node:sqlite';
import { hasPushDevice, pushToUser, type PushSender } from '../push.js';
import { friendlyMailError } from './errors.js';
import type { MailAccountRow } from './store.js';
import { toConnection } from './store.js';
import type { MailBackend } from './types.js';

/** Liegt die letzte Prüfung länger zurück (Gerät lange abgemeldet, Server aus), wird neu begonnen statt alte Mails nachzumelden. */
const STALE_MS = 24 * 3_600_000;
/** Nach so vielen Fehlschlägen in Folge (falsches Passwort …) wird nur noch stündlich geprüft. */
const MAX_FAILURES = 5;
const SLOW_RETRY_MS = 3_600_000;
const SHOW_INDIVIDUALLY = 3;

export interface PollResult {
  checked: number;
  notified: number;
  failed: number;
}

/**
 * Prüft die Posteingänge aller Betreuer, die Mail-Benachrichtigungen an haben und mindestens ein Gerät für Push angemeldet haben,
 * und meldet neue, ungelesene Mails. Der Ausgangspunkt ist die höchste UID: Die erste Prüfung meldet nichts (sonst käme der ganze
 * ungelesene Bestand), danach nur, was neu dazukommt. Eine Verbindung je Betreuer und Prüfung, nacheinander.
 */
export async function pollMail(db: DatabaseSync, key: Buffer, backend: MailBackend, send: PushSender, now = Date.now()): Promise<PollResult> {
  const rows = db.prepare('SELECT * FROM mail_accounts WHERE notify = 1').all() as unknown as MailAccountRow[];
  const result: PollResult = { checked: 0, notified: 0, failed: 0 };
  for (const row of rows) {
    if (!hasPushDevice(db, row.userId)) continue;
    if (row.failures >= MAX_FAILURES && row.checkedAt && now - row.checkedAt < SLOW_RETRY_MS) continue;
    result.checked++;
    try {
      const stale = !row.checkedAt || now - row.checkedAt > STALE_MS;
      const check = await backend.checkNew(toConnection(key, row), { uidValidity: stale ? null : row.uidValidity, lastUid: stale ? null : row.lastUid });
      db.prepare('UPDATE mail_accounts SET uidValidity = ?, lastUid = ?, checkedAt = ?, failures = 0, lastError = ? WHERE userId = ?').run(check.uidValidity, check.maxUid, now, '', row.userId);
      if (check.fresh.length === 0) continue;
      const items = check.fresh;
      if (items.length <= SHOW_INDIVIDUALLY) {
        for (const m of items) {
          result.notified += await pushToUser(db, send, row.userId, { title: m.from || 'Neue Mail', body: m.subject || '(ohne Betreff)', url: `/#/mail/m/INBOX/${m.uid}`, tag: `mail:${m.uid}` });
        }
      } else {
        result.notified += await pushToUser(db, send, row.userId, { title: `${items.length} neue Mails`, body: items.slice(0, 3).map((m) => m.from).join(', ') + ' …', url: '/#/mail', tag: 'mail:many' });
      }
    } catch (e) {
      result.failed++;
      db.prepare('UPDATE mail_accounts SET failures = failures + 1, checkedAt = ?, lastError = ? WHERE userId = ?').run(now, friendlyMailError(e).message, row.userId);
    }
  }
  return result;
}
