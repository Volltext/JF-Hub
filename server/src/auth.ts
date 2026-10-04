import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import { getConfig, getSettings, type Role, type UserRow } from './db.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const DAY = 86_400_000;

export const MIN_PASSWORD_LENGTH = 10;
export const INVITE_DAYS = 7;
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Zum Angleichen der Antwortzeit, wenn der Benutzername unbekannt ist (verhindert das Erraten von Namen). */
const DUMMY_HASH = await hashPassword(randomBytes(12).toString('hex'));

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ---------- Benutzer ----------

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export const publicUser = (u: UserRow): PublicUser => ({ id: u.id, username: u.username, displayName: u.displayName || u.username, role: u.role });

export class UserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function countUsers(db: DatabaseSync): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export const getUser = (db: DatabaseSync, id: string): UserRow | undefined => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

export const getUserByName = (db: DatabaseSync, username: string): UserRow | undefined =>
  db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;

export function listUsers(db: DatabaseSync): UserRow[] {
  return db.prepare('SELECT * FROM users ORDER BY role, username').all() as unknown as UserRow[];
}

export function checkUsername(username: unknown): string {
  if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
    throw new UserError('Benutzername: 3–32 Zeichen (Buchstaben, Ziffern, Punkt, Unterstrich, Bindestrich), beginnt mit Buchstabe oder Ziffer');
  }
  return username.trim();
}

export function checkPasswordRules(password: unknown): string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) throw new UserError(`Passwort mindestens ${MIN_PASSWORD_LENGTH} Zeichen`);
  if (password.length > 200) throw new UserError('Passwort zu lang');
  return password;
}

const cleanName = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : fallback);

export async function createUser(
  db: DatabaseSync,
  input: { username: unknown; displayName?: unknown; role: Role; password?: string },
): Promise<UserRow> {
  const username = checkUsername(input.username);
  if (getUserByName(db, username)) throw new UserError('Benutzername ist schon vergeben', 409);
  const row: UserRow = {
    id: randomUUID().replace(/-/g, ''),
    username,
    displayName: cleanName(input.displayName, username),
    role: input.role,
    passwordHash: input.password ? await hashPassword(checkPasswordRules(input.password)) : null,
    inviteHash: null,
    inviteExpiresAt: null,
    disabled: 0,
    createdAt: Date.now(),
    lastLoginAt: null,
  };
  db.prepare(
    'INSERT INTO users(id, username, displayName, role, passwordHash, inviteHash, inviteExpiresAt, disabled, createdAt, lastLoginAt) VALUES(?,?,?,?,?,?,?,?,?,?)',
  ).run(row.id, row.username, row.displayName, row.role, row.passwordHash, null, null, 0, row.createdAt, null);
  return row;
}

export function activeAdminCount(db: DatabaseSync, exceptId?: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?").get(exceptId ?? '') as { n: number }).n;
}

export function updateUser(db: DatabaseSync, id: string, patch: { displayName?: unknown; role?: unknown; disabled?: unknown }): UserRow {
  const user = getUser(db, id);
  if (!user) throw new UserError('Benutzer nicht gefunden', 404);
  const displayName = patch.displayName === undefined ? user.displayName : cleanName(patch.displayName, user.username);
  const role = patch.role === undefined ? user.role : patch.role;
  if (role !== 'admin' && role !== 'betreuer') throw new UserError('Rolle ungültig');
  const disabled = patch.disabled === undefined ? user.disabled : patch.disabled ? 1 : 0;
  if ((role !== 'admin' || disabled) && user.role === 'admin' && !user.disabled && activeAdminCount(db, id) === 0) {
    throw new UserError('Es muss mindestens ein aktiver Admin bleiben');
  }
  db.prepare('UPDATE users SET displayName = ?, role = ?, disabled = ? WHERE id = ?').run(displayName, role, disabled, id);
  if (disabled || role !== user.role) db.prepare('DELETE FROM sessions WHERE userId = ?').run(id);
  return getUser(db, id)!;
}

/**
 * Entfernt einen Benutzer. Seine privaten Protokolle und Aufgaben werden gelöscht,
 * veröffentlichte gehen an `newOwnerId` (den löschenden Admin).
 */
export function deleteUser(db: DatabaseSync, id: string, newOwnerId: string): void {
  const user = getUser(db, id);
  if (!user) throw new UserError('Benutzer nicht gefunden', 404);
  if (id === newOwnerId) throw new UserError('Das eigene Konto kann nicht gelöscht werden');
  if (user.role === 'admin' && !user.disabled && activeAdminCount(db, id) === 0) throw new UserError('Es muss mindestens ein aktiver Admin bleiben');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM protocols WHERE ownerId = ? AND shared = 0').run(id);
    db.prepare("DELETE FROM records WHERE ownerId = ? AND shared = 0 AND collection = 'tasks'").run(id);
    db.prepare('UPDATE protocols SET ownerId = ? WHERE ownerId = ?').run(newOwnerId, id);
    db.prepare('UPDATE records SET ownerId = ? WHERE ownerId = ?').run(newOwnerId, id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- Einladung / Passwort ----------

/** Neuer Einladungscode (gilt für die Passwortvergabe, 7 Tage). Der Klartext wird nur hier zurückgegeben. */
export function createInvite(db: DatabaseSync, userId: string): { code: string; expiresAt: number } {
  if (!getUser(db, userId)) throw new UserError('Benutzer nicht gefunden', 404);
  const raw = randomBytes(8).toString('hex').toUpperCase(); // 16 Zeichen
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
  const expiresAt = Date.now() + INVITE_DAYS * DAY;
  db.prepare('UPDATE users SET inviteHash = ?, inviteExpiresAt = ? WHERE id = ?').run(sha256(code.replace(/-/g, '')), expiresAt, userId);
  return { code, expiresAt };
}

/** Nimmt eine Einladung an: setzt das Passwort, entwertet den Code und meldet alle Geräte ab. */
export async function acceptInvite(db: DatabaseSync, username: string, code: string, password: string): Promise<UserRow> {
  const user = getUserByName(db, username.trim());
  const given = sha256(String(code).replace(/[\s-]/g, '').toUpperCase());
  const ok = !!user && !user.disabled && !!user.inviteHash && (user.inviteExpiresAt ?? 0) > Date.now() && safeEqualHex(user.inviteHash, given);
  if (!ok) throw new UserError('Einladung ungültig oder abgelaufen', 403);
  checkPasswordRules(password);
  db.prepare('UPDATE users SET passwordHash = ?, inviteHash = NULL, inviteExpiresAt = NULL WHERE id = ?').run(await hashPassword(password), user.id);
  db.prepare('DELETE FROM sessions WHERE userId = ?').run(user.id);
  return getUser(db, user.id)!;
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function setUserPassword(db: DatabaseSync, userId: string, password: string, keepToken?: string): Promise<void> {
  db.prepare('UPDATE users SET passwordHash = ?, inviteHash = NULL, inviteExpiresAt = NULL WHERE id = ?').run(await hashPassword(checkPasswordRules(password)), userId);
  // alle anderen Geräte dieses Nutzers müssen sich neu anmelden
  if (keepToken) db.prepare('DELETE FROM sessions WHERE userId = ? AND hash != ?').run(userId, sha256(keepToken));
  else db.prepare('DELETE FROM sessions WHERE userId = ?').run(userId);
}

/** Prüft Benutzername + Passwort; liefert den Benutzer oder null. Die Laufzeit hängt nicht davon ab, ob der Name existiert. */
export async function authenticate(db: DatabaseSync, username: string, password: string): Promise<UserRow | null> {
  const user = getUserByName(db, username.trim());
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || user.disabled || !ok) return null;
  db.prepare('UPDATE users SET lastLoginAt = ? WHERE id = ?').run(Date.now(), user.id);
  return user;
}

/**
 * Alte Installationen (vor 2.0) kannten nur ein Passwort: es wird zum Admin-Konto „admin“,
 * bestehende Sitzungen, Protokolle und Aufgaben gehören diesem Konto (Aufgaben bleiben privat).
 */
export function migrateLegacy(db: DatabaseSync): void {
  if (countUsers(db) > 0) return;
  const legacy = getConfig(db, 'passwordHash');
  if (!legacy) return;
  const id = randomUUID().replace(/-/g, '');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("INSERT INTO users(id, username, displayName, role, passwordHash, createdAt) VALUES(?, 'admin', 'Admin', 'admin', ?, ?)").run(id, legacy, Date.now());
    db.prepare('UPDATE sessions SET userId = ? WHERE userId IS NULL').run(id);
    db.prepare("UPDATE protocols SET ownerId = ? WHERE ownerId = ''").run(id);
    db.prepare("UPDATE records SET ownerId = ? WHERE ownerId = ''").run(id);
    db.prepare("UPDATE records SET shared = 0 WHERE collection = 'tasks'").run();
    db.prepare("DELETE FROM config WHERE key = 'passwordHash'").run();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- Sitzungen ----------

export interface SessionUser extends PublicUser {
  sessionHash: string;
}

export function createSession(db: DatabaseSync, userId: string, device: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const days = Number(getSettings(db).tokenDays) || 90;
  const expiresAt = now + days * DAY;
  db.prepare('INSERT INTO sessions(hash, userId, device, createdAt, lastUsedAt, expiresAt) VALUES(?,?,?,?,?,?)').run(
    sha256(token),
    userId,
    device.slice(0, 80) || 'Unbekanntes Gerät',
    now,
    now,
    expiresAt,
  );
  return { token, expiresAt };
}

/** Prüft den Token, verlängert die Laufzeit (gleitend) und liefert den zugehörigen Benutzer. */
export function validateSession(db: DatabaseSync, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const hash = sha256(token);
  const row = db
    .prepare(
      `SELECT s.expiresAt, u.* FROM sessions s JOIN users u ON u.id = s.userId WHERE s.hash = ? AND u.disabled = 0`,
    )
    .get(hash) as unknown as (UserRow & { expiresAt: number }) | undefined;
  const now = Date.now();
  if (!row || row.expiresAt < now) return null;
  const days = Number(getSettings(db).tokenDays) || 90;
  db.prepare('UPDATE sessions SET lastUsedAt = ?, expiresAt = ? WHERE hash = ?').run(now, now + days * DAY, hash);
  return { ...publicUser(row), sessionHash: hash };
}

export function revokeSession(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessions WHERE hash = ?').run(sha256(token));
}

export interface SessionInfo {
  id: string;
  device: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  current: boolean;
  username?: string;
}

/** Geräte eines Nutzers (`userId`) bzw. aller Nutzer (ohne `userId`, nur für Admins). */
export function listSessions(db: DatabaseSync, currentToken?: string, userId?: string): SessionInfo[] {
  const current = currentToken ? sha256(currentToken) : '';
  const rows = db
    .prepare(
      `SELECT s.hash, s.device, s.createdAt, s.lastUsedAt, s.expiresAt, u.username FROM sessions s LEFT JOIN users u ON u.id = s.userId
       ${userId ? 'WHERE s.userId = ?' : ''} ORDER BY s.lastUsedAt DESC`,
    )
    .all(...(userId ? [userId] : [])) as { hash: string; device: string; createdAt: number; lastUsedAt: number; expiresAt: number; username: string | null }[];
  return rows.map((r) => ({
    id: r.hash.slice(0, 16),
    device: r.device,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    current: r.hash === current,
    ...(userId ? {} : { username: r.username ?? '?' }),
  }));
}

export function revokeSessionById(db: DatabaseSync, id: string, userId?: string): void {
  if (userId) db.prepare('DELETE FROM sessions WHERE substr(hash, 1, 16) = ? AND userId = ?').run(id, userId);
  else db.prepare('DELETE FROM sessions WHERE substr(hash, 1, 16) = ?').run(id);
}

export function revokeOtherSessions(db: DatabaseSync, userId: string, keepToken?: string): void {
  if (keepToken) db.prepare('DELETE FROM sessions WHERE userId = ? AND hash != ?').run(userId, sha256(keepToken));
  else db.prepare('DELETE FROM sessions WHERE userId = ?').run(userId);
}

export function purgeExpiredSessions(db: DatabaseSync): void {
  db.prepare('DELETE FROM sessions WHERE expiresAt < ?').run(Date.now());
}

/** Einmal-Code für die Ersteinrichtung (wird nur ins Log geschrieben). */
export function newSetupCode(): string {
  return randomBytes(6).toString('hex').toUpperCase();
}

/**
 * Zusätzliche Bremse je Benutzername (zusätzlich zur Begrenzung je IP): wer von vielen Adressen aus
 * dasselbe Konto bestürmt, wird ebenfalls gebremst. Nur im Speicher, setzt sich beim Neustart zurück.
 */
export class LoginThrottle {
  private fails = new Map<string, number[]>();
  constructor(
    private readonly max = 12,
    private readonly windowMs = 15 * 60_000,
  ) {}
  private recent(key: string): number[] {
    const now = Date.now();
    const list = (this.fails.get(key.toLowerCase()) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.fails.set(key.toLowerCase(), list);
    else this.fails.delete(key.toLowerCase());
    return list;
  }
  blocked(key: string): boolean {
    return this.recent(key).length >= this.max;
  }
  fail(key: string): void {
    const list = this.recent(key);
    list.push(Date.now());
    this.fails.set(key.toLowerCase(), list);
  }
  reset(key: string): void {
    this.fails.delete(key.toLowerCase());
  }
}
