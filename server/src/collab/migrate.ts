import type { DatabaseSync } from 'node:sqlite';
import * as Y from 'yjs';
import { createBackup } from '../backup.js';
import { normalizeContent } from '../blobs.js';
import { getConfig, nextRev, setConfig } from '../db.js';
import { validateContent } from '../sync.js';
import { canonicalJson, FIELD, jsonToYDoc, yDocToJson } from './convert.js';
import { LIMITS } from './exchange.js';

export interface YMigrationFailure {
  id: string;
  title: string;
  reason: string;
}

export interface YMigrationResult {
  /** Umgestellte Protokolle (auch die im Papierkorb). */
  migrated: number;
  /** Protokolle, die so bleiben, wie sie waren (nur lesbar), und warum. */
  failed: YMigrationFailure[];
  /** Name des Backups, das vor dem Eingriff angelegt wurde. */
  backup?: string;
}

/** Protokolle, deren Text noch nicht als Yjs-Dokument vorliegt. Geleerte (Grabsteine) haben keinen Text mehr. */
const PENDING = 'ymode = 0 AND purgedAt IS NULL';

const FAILED_KEY = 'yMigrationFailed';

type Prepared = { kind: 'empty' } | { kind: 'doc'; state: Uint8Array; sv: Uint8Array } | { kind: 'failed'; reason: string };

/** Warum sich dieser Inhalt (noch) nicht umstellen lässt, ohne zu rechnen. `null`: nichts spricht dagegen. */
function blocker(content: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return 'Inhalt nicht lesbar';
  }
  const invalid = validateContent(json);
  if (invalid) return invalid;
  try {
    // Steckt noch ein Foto oder eine Datei im Inhalt, die als Anhang ausgelagert werden kann? Die Auslagerung läuft vor der Umstellung
    // (und wiederholt sich bei jedem Start); im Yjs-Dokument hätten die Daten nichts verloren und würden jede Übertragung aufblähen.
    if (normalizeContent(json, false).blobs.length > 0) return 'Fotos und Dateien sind noch nicht als Anhänge ausgelagert';
  } catch {
    return 'Inhalt nicht lesbar';
  }
  return null;
}

/** Baut den Yjs-Zustand und prüft ihn gegen den Inhalt. Schreibt nichts. */
function prepare(content: string): Prepared {
  const failed = (reason: string): Prepared => ({ kind: 'failed', reason });
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return failed('Inhalt nicht lesbar');
  }
  try {
    const doc = jsonToYDoc(json);
    if (doc.getXmlFragment(FIELD).length === 0) return { kind: 'empty' };
    const state = Y.encodeStateAsUpdate(doc);
    if (state.length > LIMITS.maxState) return failed('Protokoll zu groß');
    // Gegenprobe: Der Zustand wird so gelesen, wie der Server ihn später liest, und muss denselben Inhalt ergeben.
    const check = new Y.Doc();
    Y.applyUpdate(check, state);
    if (canonicalJson(yDocToJson(check)) !== canonicalJson(json)) return failed('Der Text lässt sich nicht verlustfrei umwandeln');
    return { kind: 'doc', state, sv: Y.encodeStateVector(doc) };
  } catch (e) {
    return failed(e instanceof Error && e.message ? e.message : 'unbekannter Fehler');
  }
}

function saveFailures(db: DatabaseSync, failed: YMigrationFailure[]): void {
  if (failed.length) setConfig(db, FAILED_KEY, JSON.stringify(failed));
  else db.prepare('DELETE FROM config WHERE key = ?').run(FAILED_KEY);
}

/**
 * Stellt den Text der Protokolle auf Yjs um (ab 3.0.0 wird er zusammen bearbeitet). Bis 2.3.x stand er nur als JSON in der Zeile.
 *
 * Je Protokoll eine Transaktion: Der Zustand wird aus dem JSON gebaut, gegen den Inhalt geprüft und dann zusammen mit `ymode = 1`
 * geschrieben. Was die Gegenprobe nicht besteht oder sich nicht schreiben lässt, bleibt unverändert (nur lesbar), wird gemeldet und
 * beim nächsten Lauf erneut versucht. Der Schnappschuss (`content`) und die Änderungszeit bleiben unberührt; die Revision steigt,
 * damit die Geräte erfahren, dass der Text nun zusammen bearbeitet wird. Vor dem ersten Eingriff sichert der Server die Datenbank
 * (Backup der Art „update“), falls ein Backup-Ordner eingerichtet ist und `backedUp` nicht sagt, dass das im selben Start schon
 * geschehen ist. Protokolle, aus denen sich noch Anhänge auslagern lassen, kommen erst danach dran. Wiederholbar.
 */
export function migrateYjs(db: DatabaseSync, opts: { backupDir?: string; backedUp?: boolean; log?: (message: string) => void } = {}): YMigrationResult {
  const result: YMigrationResult = { migrated: 0, failed: [] };
  const log = opts.log ?? (() => undefined);
  const pending = (db.prepare(`SELECT id FROM protocols WHERE ${PENDING} ORDER BY rev`).all() as { id: string }[]).map((r) => r.id);

  // Erster Durchgang ohne Rechnen und Schreiben: Was lässt sich überhaupt umstellen? Nur dann lohnen Backup und Transaktionen.
  const read = db.prepare('SELECT title, content, ymode FROM protocols WHERE id = ?');
  const todo: string[] = [];
  for (const id of pending) {
    const r = read.get(id) as { title: string; content: string; ymode: number } | undefined;
    if (!r || r.ymode !== 0) continue;
    const reason = blocker(r.content);
    if (reason) result.failed.push({ id, title: r.title, reason });
    else todo.push(id);
  }
  if (!todo.length) {
    saveFailures(db, result.failed);
    return result;
  }

  if (opts.backupDir && !opts.backedUp) {
    result.backup = createBackup(db, opts.backupDir, 'update').name;
    log(`Der Text von ${todo.length} Protokoll(en) wird auf gemeinsames Bearbeiten umgestellt; Sicherung vorher: ${result.backup}`);
  }

  const putState = db.prepare(
    `INSERT INTO ydocs(id, state, sv, updatedAt) VALUES(?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET state = excluded.state, sv = excluded.sv, updatedAt = excluded.updatedAt`,
  );
  const markDone = db.prepare('UPDATE protocols SET ymode = 1, rev = ? WHERE id = ?');
  for (const id of todo) {
    const r = read.get(id) as { title: string; content: string; ymode: number } | undefined;
    if (!r || r.ymode !== 0) continue;
    const prepared = prepare(r.content);
    if (prepared.kind === 'failed') {
      result.failed.push({ id, title: r.title, reason: prepared.reason });
      continue;
    }
    db.exec('SAVEPOINT ymigrate');
    try {
      if (prepared.kind === 'doc') putState.run(id, prepared.state, prepared.sv, Date.now());
      markDone.run(nextRev(db), id);
      db.exec('RELEASE ymigrate');
      result.migrated++;
    } catch (e) {
      db.exec('ROLLBACK TO ymigrate');
      db.exec('RELEASE ymigrate');
      result.failed.push({ id, title: r.title, reason: e instanceof Error && e.message ? e.message : 'unbekannter Fehler' });
    }
  }
  saveFailures(db, result.failed);
  log(`Umgestellt: ${result.migrated} Protokoll(e)${result.failed.length ? `, ${result.failed.length} bleiben nur lesbar` : ''}`);
  for (const f of result.failed) log(`Protokoll ${f.id} („${f.title}“) bleibt nur lesbar: ${f.reason}`);
  return result;
}

export interface CollabStats {
  /** Protokolle mit Yjs-Zustand. */
  docs: number;
  /** Größe aller Zustände in Byte. */
  bytes: number;
  /** Protokolle, die noch nicht umgestellt sind (nur lesbar). */
  pending: number;
  /** Die noch nicht umgestellten Protokolle mit dem Grund des letzten Versuchs. */
  failed: YMigrationFailure[];
}

/** Kennzahlen für die Verwaltung („Info“). */
export function collabStats(db: DatabaseSync): CollabStats {
  const states = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(length(state)), 0) AS bytes FROM ydocs').get() as { n: number; bytes: number };
  const pending = db.prepare(`SELECT id, title FROM protocols WHERE ${PENDING} ORDER BY rev`).all() as { id: string; title: string }[];
  let known: YMigrationFailure[] = [];
  try {
    const parsed: unknown = JSON.parse(getConfig(db, FAILED_KEY) ?? '[]');
    if (Array.isArray(parsed)) known = parsed as YMigrationFailure[];
  } catch {
    /* kein Grund bekannt */
  }
  const reasons = new Map(known.map((f) => [f.id, f.reason]));
  return {
    docs: Number(states.n),
    bytes: Number(states.bytes),
    pending: pending.length,
    failed: pending.slice(0, 50).map((p) => ({ id: p.id, title: p.title, reason: reasons.get(p.id) ?? 'noch nicht umgestellt' })),
  };
}
