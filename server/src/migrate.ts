import type { DatabaseSync } from 'node:sqlite';
import { createBackup } from './backup.js';
import { normalizeContent, refreshRefs, saveBlobs } from './blobs.js';
import { nextRev } from './db.js';

export interface MigrationResult {
  /** Protokolle, deren Anhänge ausgelagert wurden. */
  protocols: number;
  /** Neu angelegte Blobs (gleiche Anhänge zählen einmal). */
  blobs: number;
  /** Protokolle, in denen etwas nicht ausgelagert werden konnte (zum Beispiel ein Foto, das kein JPEG ist, oder ein unlesbarer Inhalt). */
  skipped: number;
  /** Name des Backups, das vor dem Eingriff angelegt wurde. */
  backup?: string;
}

/** Protokolle, in deren Inhalt noch Fotos (Data-URL) oder Dateien (Base64) stecken. Der Filter ist grob, geprüft wird danach. */
const CANDIDATES = `SELECT id FROM protocols WHERE content GLOB '*"src":"data:*' OR content GLOB '*"data":"[A-Za-z0-9+/]*' ORDER BY rev`;

/** Was gäbe es bei diesem Protokoll zu tun? Unlesbarer Inhalt zählt als nicht auslagerbar. */
function plan(db: DatabaseSync, id: string): { change: boolean; skipped: boolean } {
  const row = db.prepare('SELECT content FROM protocols WHERE id = ?').get(id) as { content: string } | undefined;
  if (!row) return { change: false, skipped: false };
  try {
    const normalized = normalizeContent(JSON.parse(row.content), false);
    return { change: normalized.blobs.length > 0, skipped: normalized.skipped > 0 };
  } catch {
    return { change: false, skipped: true };
  }
}

/**
 * Löst Fotos und Dateien aus den Protokollen heraus (bis 2.1.x steckten sie als Base64 im Inhalt) und legt sie als Blobs ab.
 * Wiederholbar: Was schon ausgelagert ist, wird nicht mehr gefunden. Vor dem ersten Eingriff sichert der Server die Datenbank
 * (Backup der Art „update“), falls ein Backup-Ordner eingerichtet ist.
 *
 * Die Änderungszeit der Protokolle bleibt unberührt. Die Revision steigt, damit die Geräte die schlanke Fassung bekommen.
 */
export function migrateBlobs(db: DatabaseSync, opts: { backupDir?: string; log?: (message: string) => void } = {}): MigrationResult {
  const result: MigrationResult = { protocols: 0, blobs: 0, skipped: 0 };
  const log = opts.log ?? (() => undefined);

  // Erster Durchgang ohne Schreiben: Was ist überhaupt auszulagern? Nur dann lohnen Backup und Transaktion.
  const todo: string[] = [];
  for (const { id } of db.prepare(CANDIDATES).all() as { id: string }[]) {
    const p = plan(db, id);
    if (p.skipped) result.skipped++;
    if (p.change) todo.push(id);
  }
  if (!todo.length) return result;

  if (opts.backupDir) {
    result.backup = createBackup(db, opts.backupDir, 'update').name;
    log(`Anhänge werden aus den Protokollen ausgelagert; Sicherung vorher: ${result.backup}`);
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const id of todo) {
      const row = db.prepare('SELECT content, ownerId FROM protocols WHERE id = ?').get(id) as { content: string; ownerId: string } | undefined;
      if (!row) continue;
      const normalized = normalizeContent(JSON.parse(row.content), false);
      if (!normalized.blobs.length) continue;
      result.blobs += saveBlobs(db, normalized.blobs, row.ownerId);
      db.prepare('UPDATE protocols SET content = ?, rev = ? WHERE id = ?').run(JSON.stringify(normalized.content), nextRev(db), id);
      refreshRefs(db, id, normalized.content);
      result.protocols++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  log(`Ausgelagert: ${result.protocols} Protokoll(e), ${result.blobs} Anhang/Anhänge${result.skipped ? `, ${result.skipped} Protokoll(e) nicht vollständig auslagerbar` : ''}`);
  return result;
}
