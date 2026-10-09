import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrateLegacy } from './auth.js';
import { getConfig, openDb, setConfig } from './db.js';
import { migrateBlobs } from './migrate.js';

/**
 * Backups der SQLite-Datenbank: automatisch (täglich), manuell, als Sicherheitskopie vor einer Wiederherstellung oder vor einem
 * Update, das die Daten umbaut. Dateien liegen im Datenordner (`/data/backups`) und tragen die Art und den Zeitpunkt im Namen.
 */
export type BackupKind = 'auto' | 'manuell' | 'vorher' | 'update';

export interface BackupInfo {
  name: string;
  kind: BackupKind;
  size: number;
  createdAt: number;
}

const NAME_RE = /^jf-hub-(auto|manuell|vorher|update)-(\d{8})-(\d{6})(?:-\d+)?\.sqlite$/;
const DAY = 86_400_000;

/** Sicherungen vor einer Wiederherstellung werden nur begrenzt aufgehoben. */
const KEEP_BEFORE_RESTORE = 3;
/** Sicherungen vor einem Update ebenso (jede ist eine vollständige Kopie der Datenbank). */
const KEEP_BEFORE_UPDATE = 2;

export function isBackupName(name: string): boolean {
  return NAME_RE.test(name);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Legt mit `VACUUM INTO` eine konsistente Kopie an (auch bei laufendem Betrieb). */
export function createBackup(db: DatabaseSync, dir: string, kind: BackupKind, now = new Date()): BackupInfo {
  mkdirSync(dir, { recursive: true });
  const base = `jf-hub-${kind}-${stamp(now)}`;
  let name = `${base}.sqlite`;
  for (let i = 2; existsSync(join(dir, name)); i++) name = `${base}-${i}.sqlite`;
  const file = join(dir, name);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return describe(dir, name)!;
}

function describe(dir: string, name: string): BackupInfo | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  let size: number;
  try {
    size = statSync(join(dir, name)).size;
  } catch {
    return null;
  }
  const d = m[2];
  const t = m[3];
  const createdAt = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)).getTime();
  return { name, kind: m[1] as BackupKind, size, createdAt };
}

/** Neueste zuerst. */
export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((n) => describe(dir, n))
    .filter((b): b is BackupInfo => b !== null)
    .sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
}

export function backupPath(dir: string, name: string): string | null {
  return isBackupName(name) && existsSync(join(dir, name)) ? join(dir, name) : null;
}

export function deleteBackup(dir: string, name: string): boolean {
  const p = backupPath(dir, name);
  if (!p) return false;
  rmSync(p, { force: true });
  return true;
}

/** Behält die letzten `keepAuto` automatischen Backups (und wenige Sicherungen vor Wiederherstellungen); manuelle bleiben. */
export function pruneBackups(dir: string, keepAuto: number): void {
  const all = listBackups(dir);
  all
    .filter((b) => b.kind === 'auto')
    .slice(Math.max(0, keepAuto))
    .forEach((b) => deleteBackup(dir, b.name));
  all
    .filter((b) => b.kind === 'vorher')
    .slice(KEEP_BEFORE_RESTORE)
    .forEach((b) => deleteBackup(dir, b.name));
  all
    .filter((b) => b.kind === 'update')
    .slice(KEEP_BEFORE_UPDATE)
    .forEach((b) => deleteBackup(dir, b.name));
}

/** Anzahl automatischer Backups, die aufgehoben werden (0 = automatische Backups aus). */
export function autoKeep(db: DatabaseSync): number {
  const n = Number(getConfig(db, 'backupKeep') ?? '7');
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 365) : 7;
}

/** Legt ein automatisches Backup an, wenn das letzte älter als ein Tag ist. Gibt das neue Backup zurück. */
export function runAutoBackup(db: DatabaseSync, dir: string, now = new Date()): BackupInfo | null {
  const keep = autoKeep(db);
  if (keep === 0) return null;
  const last = listBackups(dir).find((b) => b.kind === 'auto');
  if (last && now.getTime() - last.createdAt < DAY - 60_000) return null;
  const made = createBackup(db, dir, 'auto', now);
  pruneBackups(dir, keep);
  return made;
}

export class RestoreError extends Error {}

/** Konfigurationswerte, die zur laufenden Installation gehören und eine Wiederherstellung überdauern. */
const KEEP_CONFIG = ['vapidPublic', 'vapidPrivate'];

/**
 * Ersetzt den gesamten Inhalt der laufenden Datenbank durch den der Datei `file`.
 * Die Datei wird zuerst auf einer Kopie geprüft und migriert (ältere Sicherungen sind erlaubt).
 * Die Push-Schlüssel dieses Servers bleiben erhalten, damit bestehende Abos gültig bleiben. Alle Clients bekommen
 * eine neue Epoche, laden daraufhin alles neu und senden hoch, was in der Sicherung fehlt.
 * Alle Anmeldungen (Sitzungen) stammen aus der Sicherung – wer dort nicht existierte, muss sich neu anmelden.
 */
export function restoreFromFile(db: DatabaseSync, file: string): void {
  const work = mkdtempSync(join(tmpdir(), 'jfh-restore-'));
  const copy = join(work, 'restore.sqlite');
  try {
    copyFileSync(file, copy);
    assertJfHubDatabase(copy);
    // Migrationen für ältere Sicherungen (auch 1.x) laufen auf der Kopie; ohne Admin-Konto käme niemand mehr hinein.
    const prepared = openDb(copy);
    try {
      migrateLegacy(prepared);
      migrateBlobs(prepared); // Sicherungen vor 2.2.0 tragen Fotos und Dateien noch im Inhalt der Protokolle.
      const admins = prepared.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND passwordHash IS NOT NULL").get() as { n: number };
      if (!admins.n) throw new RestoreError('Die Sicherung enthält kein nutzbares Admin-Konto, du könntest dich danach nicht mehr anmelden.');
    } finally {
      prepared.close();
    }

    const keep = Object.fromEntries(KEEP_CONFIG.map((k) => [k, getConfig(db, k)]));
    const liveRev = Number(getConfig(db, 'revCounter') ?? '0');

    db.exec(`ATTACH DATABASE '${copy.replace(/'/g, "''")}' AS bak`);
    try {
      const tables = (db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const t of tables) {
          const q = `"${t.replace(/"/g, '""')}"`;
          const mine = (db.prepare(`PRAGMA main.table_info(${q})`).all() as { name: string }[]).map((c) => c.name);
          const theirs = new Set((db.prepare(`PRAGMA bak.table_info(${q})`).all() as { name: string }[]).map((c) => c.name));
          db.exec(`DELETE FROM main.${q}`);
          const cols = mine.filter((c) => theirs.has(c)).map((c) => `"${c.replace(/"/g, '""')}"`);
          if (cols.length) db.exec(`INSERT INTO main.${q} (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM bak.${q}`);
        }
        for (const [k, v] of Object.entries(keep)) if (v !== undefined) setConfig(db, k, v);
        // Revisionen nie zurückdrehen und neue Epoche, damit sich alle Clients neu abgleichen.
        setConfig(db, 'revCounter', String(Math.max(liveRev, Number(getConfig(db, 'revCounter') ?? '0'))));
        setConfig(db, 'epoch', randomUUID());
        const bad = db.prepare('PRAGMA foreign_key_check').all();
        if (bad.length) throw new RestoreError('Die Sicherung ist in sich nicht stimmig (verwaiste Verweise).');
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        db.exec('PRAGMA foreign_keys = ON');
      }
    } finally {
      db.exec('DETACH DATABASE bak');
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Prüft vor jeder Veränderung, dass die Datei eine JF-Hub-Datenbank ist (und nicht irgendeine). */
function assertJfHubDatabase(file: string): void {
  let probe: DatabaseSync | undefined;
  try {
    probe = new DatabaseSync(file, { readOnly: true });
    const names = new Set((probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
    if (!['protocols', 'config', 'records'].every((n) => names.has(n))) throw new RestoreError('Das ist keine JF-Hub-Sicherung.');
    if (probe.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new RestoreError('Die Datei ist beschädigt.');
  } catch (e) {
    if (e instanceof RestoreError) throw e;
    throw new RestoreError('Das ist keine gültige SQLite-Datenbank.');
  } finally {
    probe?.close();
  }
}

/** Schreibt hochgeladene Daten in eine Wegwerf-Datei (Aufrufer räumt auf). */
export function writeUpload(data: Buffer): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'jfh-upload-'));
  const file = join(dir, 'upload.sqlite');
  writeFileSync(file, data);
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
