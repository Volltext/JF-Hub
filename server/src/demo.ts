import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.js';
import { migrateYjs } from './collab/migrate.js';
import { currentRev, getConfig, nextRev, setConfig, type Role } from './db.js';
import { DEMO_NAMES, demoData } from './demoData.js';

/**
 * Demo-Modus für eine öffentliche Probier-Instanz (`DEMO=1`): feste Zugänge, erfundene Beispieldaten der
 * „Jugendfeuerwehr Musterstadt“ und ein tägliches Zurücksetzen. Was Besucher eintragen, ist danach wieder weg.
 *
 * Beim Zurücksetzen bekommen die Konten neue IDs und alle Sitzungen enden. Geräte landen dadurch auf der Anmeldung
 * und räumen beim nächsten Anmelden ihre lokale Kopie ab (Kontowechsel) – sonst würden sie ihre alten Daten
 * nach dem Epochenwechsel wieder hochladen.
 */

export interface DemoAccount {
  username: string;
  password: string;
  displayName: string;
  role: Role;
  /** Kurzbeschreibung für die Anmeldeseite. */
  hint: string;
}

export const DEMO_PASSWORD = 'jfhub-demo';

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { username: 'jugendwart', password: DEMO_PASSWORD, displayName: DEMO_NAMES.jana, role: 'admin', hint: 'Jugendwartin, darf auch die Server-Verwaltung' },
  { username: 'betreuer', password: DEMO_PASSWORD, displayName: DEMO_NAMES.tobias, role: 'betreuer', hint: 'Betreuer' },
];

export const isDemoAccount = (username: unknown): boolean =>
  typeof username === 'string' && DEMO_ACCOUNTS.some((a) => a.username === username.trim().toLowerCase());

// ---------- Zeitplan ----------

export interface ResetTime {
  hour: number;
  minute: number;
}

export const DEFAULT_RESET_AT = '03:00';

/** Liest `DEMO_RESET_AT` (Uhrzeit `HH:MM` in der Zeitzone des Servers). Leer = 03:00. */
export function parseResetAt(v: string | undefined): ResetTime {
  const text = (v ?? '').trim() || DEFAULT_RESET_AT;
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`DEMO_RESET_AT: Uhrzeit als HH:MM angeben (z. B. 03:00), nicht „${text}“`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export const formatResetAt = (t: ResetTime): string => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;

/** Millisekunden bis zum nächsten Zurücksetzen (heute, falls die Uhrzeit noch kommt, sonst morgen). */
export function msUntilReset(now: Date, at: ResetTime): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), at.hour, at.minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

// ---------- Schutz der gemeinsamen Zugänge ----------

export const DEMO_LOCKED = 'In der Demo ausgeschaltet.';

/** Was alle Besucher aussperren oder an fremde Daten kommen würde (Backups enthalten z. B. die Push-Schlüssel). */
const LOCKED = new Set([
  'POST /api/account/password',
  'POST /api/account/sessions/revoke-others',
  'DELETE /api/account/sessions/:id',
  'DELETE /api/admin/sessions/:id',
  'GET /api/admin/backup',
  'POST /api/admin/backups',
  'GET /api/admin/backups/:name',
  'DELETE /api/admin/backups/:name',
  'POST /api/admin/backups/:name/restore',
  'POST /api/admin/restore',
]);

/** Gesperrt, wenn sie eines der Demo-Konten betreffen; selbst angelegte Benutzer dürfen Besucher ändern und löschen. */
const LOCKED_FOR_DEMO_ACCOUNTS = new Set(['PATCH /api/admin/users/:id', 'DELETE /api/admin/users/:id', 'POST /api/admin/users/:id/invite']);

/** Fehlermeldung, wenn die Anfrage im Demo-Modus nicht erlaubt ist, sonst null. `route` ist das Muster der Route. */
export function demoBlock(db: DatabaseSync, method: string, route: string | undefined, params: unknown): string | null {
  if (!route) return null;
  // HEAD führt die GET-Route aus (nur ohne Antworttext) und ist deshalb genauso gesperrt.
  const key = `${method === 'HEAD' ? 'GET' : method} ${route}`;
  if (LOCKED.has(key)) return DEMO_LOCKED;
  if (LOCKED_FOR_DEMO_ACCOUNTS.has(key)) {
    const id = (params as { id?: unknown } | null)?.id;
    const row = db.prepare('SELECT username FROM users WHERE id = ?').get(String(id ?? '')) as { username: string } | undefined;
    if (row && isDemoAccount(row.username)) return `${DEMO_LOCKED} Die Demo-Zugänge bleiben für alle gleich.`;
  }
  return null;
}

// ---------- Zurücksetzen ----------

/** Zur Laufzeit erzeugte Server-Werte, die ein Zurücksetzen überdauern (bestehende Push-Abos der Browser bleiben gültig). */
const KEEP_CONFIG = ['vapidPublic', 'vapidPrivate'];

/**
 * Leert die Datenbank und legt die Beispieldaten neu an. Die Daten sind relativ zu `now` datiert,
 * damit die Demo immer aktuell aussieht (letzter Dienst am vergangenen Montag, Aufgaben in den nächsten Tagen fällig).
 */
export async function resetDemo(db: DatabaseSync, now = new Date()): Promise<void> {
  // Passwörter vorher berechnen: während der Transaktion darf nichts anderes auf der Verbindung laufen.
  const hashes = await Promise.all(DEMO_ACCOUNTS.map((a) => hashPassword(a.password)));
  const keep = Object.fromEntries(KEEP_CONFIG.map((k) => [k, getConfig(db, k)]));
  const liveRev = currentRev(db);

  db.exec('BEGIN IMMEDIATE');
  try {
    // Alle Tabellen, auch spätere (zum Beispiel die Anhänge der Besucher): Nur die Beispieldaten sollen übrig bleiben.
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
    for (const t of tables) db.exec(`DELETE FROM "${t.replace(/"/g, '""')}"`);
    for (const [k, v] of Object.entries(keep)) if (v !== undefined) setConfig(db, k, v);
    // Revisionen nie zurückdrehen; neue Epoche, damit Geräte ihren Stand verwerfen.
    setConfig(db, 'revCounter', String(liveRev));
    setConfig(db, 'epoch', randomUUID());
    seed(db, now, hashes);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  // Der Text der Beispielprotokolle wird zusammen bearbeitet wie überall (Yjs); die Beispieldaten kommen aus dem Code und müssen sich umstellen lassen.
  const converted = migrateYjs(db);
  if (converted.failed.length) throw new Error(`Beispieldaten ließen sich nicht umstellen: ${converted.failed.map((f) => `${f.id}: ${f.reason}`).join('; ')}`);
  // Platz von großen Anhängen der Besucher freigeben; klappt das nicht (z. B. Platte voll), gilt das Zurücksetzen trotzdem.
  try {
    db.exec('VACUUM');
  } catch {
    /* beim nächsten Zurücksetzen erneut */
  }
}

const DAY = 86_400_000;

/** Konten mit neuen IDs, dazu die Beispieldaten aus `demoData.ts`. */
function seed(db: DatabaseSync, now: Date, hashes: string[]): void {
  const t0 = now.getTime();
  const newId = () => randomUUID().replace(/-/g, '');
  const insertUser = db.prepare(
    'INSERT INTO users(id, username, displayName, role, passwordHash, inviteHash, inviteExpiresAt, disabled, createdAt, lastLoginAt) VALUES(?,?,?,?,?,?,?,0,?,NULL)',
  );
  const ids = DEMO_ACCOUNTS.map((a, i) => {
    const id = newId();
    insertUser.run(id, a.username, a.displayName, a.role, hashes[i]!, null, null, t0 - 120 * DAY);
    return id;
  });
  // Eine offene Einladung, damit die Benutzerverwaltung zeigt, wie das aussieht. Den Code kennt niemand.
  insertUser.run(newId(), 'lena', 'Lena Schröder', 'betreuer', null, createHash('sha256').update(randomBytes(16)).digest('hex'), t0 + 5 * DAY, t0 - 2 * DAY);

  const data = demoData(now, { jana: ids[0]!, tobias: ids[1]! });
  setConfig(db, 'orgName', data.orgName);
  setConfig(db, 'footer', data.footer);
  const putRecord = db.prepare('INSERT INTO records(collection, id, data, ownerId, shared, hiddenRev, rev, updatedAt, deletedAt) VALUES(?,?,?,?,?,NULL,?,?,NULL)');
  for (const r of data.records) putRecord.run(r.collection, r.id, JSON.stringify(r.data), r.ownerId, r.shared ? 1 : 0, nextRev(db), r.updatedAt);
  const putFolder = db.prepare('INSERT INTO folders(id, name, parentId, rev, updatedAt, deletedAt) VALUES(?,?,?,?,?,NULL)');
  for (const f of data.folders) putFolder.run(f.id, f.name, f.parentId, nextRev(db), f.updatedAt);
  const putProtocol = db.prepare(
    `INSERT INTO protocols(id, title, folderId, datum, beginn, ende, ort, leitung, content, ownerId, shared, hiddenRev, rev, updatedAt, deletedAt)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,NULL)`,
  );
  for (const p of data.protocols) {
    putProtocol.run(p.id, p.title, p.folderId, p.datum, p.beginn, p.ende, p.ort, p.leitung, JSON.stringify(p.content), p.ownerId, p.shared ? 1 : 0, nextRev(db), p.updatedAt);
  }
}
