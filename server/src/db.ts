import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export interface ProtocolRow {
  id: string;
  title: string;
  /** '' = oberste Ebene. */
  folderId: string;
  datum: string;
  beginn: string;
  ende: string;
  ort: string;
  leitung: string;
  /** TipTap-JSON als String. */
  content: string;
  /** Besitzer (users.id); '' nur bei Altdaten vor der Benutzerverwaltung. */
  ownerId: string;
  /** 1 = für alle Betreuer sichtbar, 0 = privat. */
  shared: number;
  /** Revision, ab der das Protokoll nicht mehr für alle sichtbar ist (damit andere Clients ihre Kopie entfernen). */
  hiddenRev: number | null;
  rev: number;
  updatedAt: number;
  deletedAt: number | null;
  /** Nur bei Konfliktkopien: die Revision, mit der die Kopie geschrieben wurde. Stimmt sie noch, hat niemand die Kopie geändert und sie darf fortgeschrieben werden. */
  conflictRev: number | null;
  /** Gesetzt, wenn der Papierkorb geleert wurde: die Zeile bleibt als leerer Grabstein, damit auch lange offline gewesene Geräte die Löschung erfahren. */
  purgedAt: number | null;
  /**
   * Nur nach der Migration der Anhänge in Blobs: die Revision davor. Eine Bearbeitung, die darauf aufbaut, ist kein Konflikt
   * (der Inhalt ist derselbe, nur anders abgelegt). Jede Änderung des Protokolls setzt den Wert zurück.
   */
  migratedFrom: number | null;
}

/** Einstellungen, die in der Admin-GUI änderbar sind (key/value in `config`). */
export interface FolderRow {
  id: string;
  name: string;
  parentId: string;
  rev: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface RecordRow {
  collection: string;
  id: string;
  data: string;
  ownerId: string;
  shared: number;
  hiddenRev: number | null;
  rev: number;
  updatedAt: number;
  deletedAt: number | null;
}

export type Role = 'admin' | 'betreuer';

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  /** null = Einladung noch nicht angenommen. */
  passwordHash: string | null;
  inviteHash: string | null;
  inviteExpiresAt: number | null;
  disabled: number;
  createdAt: number;
  lastLoginAt: number | null;
}

export const CONFIG_DEFAULTS = {
  orgName: 'Jugendfeuerwehr',
  footer: '',
  accent: '#c0392b',
  logo: '',
  tokenDays: '90',
  trashDays: '30',
  /** Wie viele automatische Backups aufgehoben werden (0 = keine). */
  backupKeep: '7',
} as const;
export type ConfigKey = keyof typeof CONFIG_DEFAULTS;

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS protocols (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      datum TEXT NOT NULL DEFAULT '',
      beginn TEXT NOT NULL DEFAULT '',
      ende TEXT NOT NULL DEFAULT '',
      ort TEXT NOT NULL DEFAULT '',
      leitung TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
      ownerId TEXT NOT NULL DEFAULT '',
      shared INTEGER NOT NULL DEFAULT 1,
      hiddenRev INTEGER,
      rev INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      deletedAt INTEGER
    );
    CREATE INDEX IF NOT EXISTS protocols_rev ON protocols(rev);
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      parentId TEXT NOT NULL DEFAULT '',
      rev INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      deletedAt INTEGER
    );
    CREATE INDEX IF NOT EXISTS folders_rev ON folders(rev);
    -- Allgemeine Datensätze (Mitglieder, Dienste, Aufgaben): JSON je Eintrag, letzte Änderung gewinnt.
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      ownerId TEXT NOT NULL DEFAULT '',
      shared INTEGER NOT NULL DEFAULT 1,
      hiddenRev INTEGER,
      rev INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      deletedAt INTEGER,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS records_rev ON records(rev);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      displayName TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'betreuer',
      passwordHash TEXT,
      inviteHash TEXT,
      inviteExpiresAt INTEGER,
      disabled INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL,
      lastLoginAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY,
      userId TEXT REFERENCES users(id) ON DELETE CASCADE,
      device TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      lastUsedAt INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    -- Web-Push: je Gerät ein Abonnement, daran hängen die vom Client vorgeplanten Erinnerungen.
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sessionHash TEXT REFERENCES sessions(hash) ON DELETE CASCADE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      device TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_reminders (
      endpoint TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      at INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '/',
      PRIMARY KEY (endpoint, kind, key)
    );
    CREATE INDEX IF NOT EXISTS push_reminders_at ON push_reminders(at);
    -- Anhänge (Fotos, Dateien) liegen binär hier und nicht im Inhalt der Protokolle. Die Kennung vergibt der Client (bzw. der Server
    -- aus dem Inhalt, wenn er Anhänge aus älteren Protokollen auslagert), uploadedAt ist der Zeitpunkt des letzten Hochladens.
    CREATE TABLE IF NOT EXISTS blobs (
      id TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      uploaderId TEXT NOT NULL DEFAULT '',
      uploadedAt INTEGER NOT NULL,
      -- Seit wann ohne Verweis (von der Müllsammlung gemerkt); leer, solange ein Protokoll darauf verweist.
      orphanedAt INTEGER,
      data BLOB NOT NULL
    );
    -- Welches Protokoll auf welchen Blob verweist. Der Blob darf fehlen (noch nicht hochgeladen), deshalb kein Fremdschlüssel darauf.
    CREATE TABLE IF NOT EXISTS blob_refs (
      blobId TEXT NOT NULL,
      protocolId TEXT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
      PRIMARY KEY (blobId, protocolId)
    );
    CREATE INDEX IF NOT EXISTS blob_refs_protocol ON blob_refs(protocolId);
  `);
  // Migration: Ordner-Zuordnung (ab 1.1.0 des Servers).
  addColumn(db, 'protocols', 'folderId', "TEXT NOT NULL DEFAULT ''");
  // Migration: Benutzerverwaltung und Sichtbarkeit (ab 2.0.0). Alte Protokolle bleiben für alle sichtbar.
  addColumn(db, 'protocols', 'ownerId', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'protocols', 'shared', 'INTEGER NOT NULL DEFAULT 1');
  addColumn(db, 'protocols', 'hiddenRev', 'INTEGER');
  // Migration: Konfliktkopien werden bei Wiederholung fortgeschrieben statt vervielfacht (ab 2.1.0).
  addColumn(db, 'protocols', 'conflictRev', 'INTEGER');
  // Migration: Papierkorb leeren hinterlässt einen Grabstein statt die Zeile zu löschen (ab 2.1.0).
  addColumn(db, 'protocols', 'purgedAt', 'INTEGER');
  // Migration: Anhänge ausgelagert; Bearbeitungen auf dem Stand davor bleiben gültig (ab 2.2.0).
  addColumn(db, 'protocols', 'migratedFrom', 'INTEGER');
  addColumn(db, 'blobs', 'orphanedAt', 'INTEGER');
  addColumn(db, 'records', 'ownerId', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'records', 'shared', 'INTEGER NOT NULL DEFAULT 1');
  addColumn(db, 'records', 'hiddenRev', 'INTEGER');
  addColumn(db, 'sessions', 'userId', 'TEXT REFERENCES users(id) ON DELETE CASCADE');
  return db;
}

function addColumn(db: DatabaseSync, table: string, column: string, def: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}

export function getConfig(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setConfig(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  );
}

export function getSettings(db: DatabaseSync): Record<ConfigKey, string> {
  const out = { ...CONFIG_DEFAULTS } as Record<ConfigKey, string>;
  for (const k of Object.keys(CONFIG_DEFAULTS) as ConfigKey[]) {
    const v = getConfig(db, k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Nächste globale Revision (monoton steigend, Grundlage des Sync; unabhängig vom Löschen alter Zeilen). */
export function nextRev(db: DatabaseSync): number {
  const next = Number(getConfig(db, 'revCounter') ?? '0') + 1;
  setConfig(db, 'revCounter', String(next));
  return next;
}

/**
 * Kennung dieser Datenbank. Ändert sie sich (neue/zurückgesetzte Datenbank), erkennen Clients,
 * dass ihr gemerkter Stand nicht mehr passt, und laden alles neu bzw. senden Unbekanntes erneut hoch.
 */
export function getEpoch(db: DatabaseSync): string {
  let e = getConfig(db, 'epoch');
  if (!e) {
    e = randomUUID();
    setConfig(db, 'epoch', e);
  }
  return e;
}

export function currentRev(db: DatabaseSync): number {
  return Number(getConfig(db, 'revCounter') ?? '0');
}
