import type { DatabaseSync } from 'node:sqlite';
import { getConfig, getEpoch, setConfig } from './db.js';

/**
 * Live-Stoppuhr: der aktuelle Stand der Stoppuhr je Modus (A-Teil, B-Teil, Disziplinen der Leistungsspange),
 * den alle Betreuer gleichzeitig sehen.
 *
 * Der Server versteht den Inhalt nicht (das rechnet die App), er vergibt nur Revisionen und verteilt Änderungen.
 * - Lesen per Long-Polling: die Anfrage wartet, bis sich etwas ändert (höchstens `waitMs`). Das kommt durch jeden
 *   Proxy und Tunnel, braucht keine offene Dauerverbindung und holt nach einer Unterbrechung alles nach.
 * - Schreiben nur auf dem neuesten Stand (`baseRev`). Sonst bekommt der Client den aktuellen Stand zurück,
 *   wendet seine Eingaben darauf erneut an und schickt das Ergebnis noch einmal. So geht nichts verloren,
 *   wenn zwei gleichzeitig tippen.
 * Laufende Zeiten stehen als Startzeitpunkt in Server-Zeit im Stand; jede Antwort enthält `now`, damit die Geräte
 * ihre Uhr abgleichen können.
 */

export const LIVE_MODE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Obergrenze für einen Stand (Notizen eingeschlossen). */
export const LIVE_MAX_BYTES = 64 * 1024;
/** Obergrenze für die Zahl der Stoppuhren (es gibt nur eine Handvoll Modi). */
export const LIVE_MAX_MODES = 64;

export interface LiveDraft {
  mode: string;
  rev: number;
  draft: unknown;
  updatedAt: number;
  /** Wer zuletzt geändert hat; null, wenn das Konto nicht mehr existiert. */
  by: { id: string; name: string } | null;
}

export interface LiveRead {
  epoch: string;
  rev: number;
  /** true: vollständige Liste (neue oder zurückgesetzte Datenbank), der Client verwirft seinen Stand. */
  full: boolean;
  drafts: LiveDraft[];
}

export type LiveWrite = { accepted: true; rev: number } | { accepted: false; current: LiveDraft | null };

interface Row {
  mode: string;
  data: string;
  rev: number;
  updatedAt: number;
  userId: string;
  name: string | null;
}

const SELECT = `SELECT l.mode, l.data, l.rev, l.updatedAt, l.userId, COALESCE(NULLIF(u.displayName, ''), u.username) AS name
  FROM live_drafts l LEFT JOIN users u ON u.id = l.userId`;

const toLive = (r: Row): LiveDraft => ({
  mode: r.mode,
  rev: r.rev,
  draft: JSON.parse(r.data) as unknown,
  updatedAt: r.updatedAt,
  by: r.name === null ? null : { id: r.userId, name: r.name },
});

export class LiveHub {
  private waiters = new Set<() => void>();
  private closing = false;

  constructor(private readonly db: DatabaseSync) {}

  /** Höchste vergebene Revision (eigener Zähler, unabhängig vom übrigen Abgleich). */
  rev(): number {
    return Number(getConfig(this.db, 'liveRev') ?? '0');
  }

  /** Alles nach `since`. Bei anderer Epoche oder unbekannt hoher Revision die vollständige Liste. */
  read(since: number, epoch: string | undefined): LiveRead {
    const current = getEpoch(this.db);
    const rev = this.rev();
    const full = epoch !== current || since > rev;
    const rows = (full
      ? this.db.prepare(`${SELECT} ORDER BY l.rev`).all()
      : this.db.prepare(`${SELECT} WHERE l.rev > ? ORDER BY l.rev`).all(since)) as unknown as Row[];
    return { epoch: current, rev, full, drafts: rows.map(toLive) };
  }

  /** Speichert den Stand eines Modus, wenn `baseRev` der aktuelle ist; sonst kommt der aktuelle Stand zurück. */
  write(mode: string, baseRev: unknown, draft: unknown, userId: string): LiveWrite {
    if (!LIVE_MODE_RE.test(mode)) throw new Error('Ungültiger Modus');
    if (typeof baseRev !== 'number' || !Number.isInteger(baseRev) || baseRev < 0) throw new Error('baseRev fehlt');
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('Stand fehlt');
    const data = JSON.stringify(draft);
    if (data.length > LIVE_MAX_BYTES) throw new Error('Stand zu groß');

    const row = this.db.prepare(`${SELECT} WHERE l.mode = ?`).get(mode) as unknown as Row | undefined;
    if ((row?.rev ?? 0) !== baseRev) return { accepted: false, current: row ? toLive(row) : null };
    if (!row && (this.db.prepare('SELECT COUNT(*) AS n FROM live_drafts').get() as { n: number }).n >= LIVE_MAX_MODES) {
      throw new Error('Zu viele Stoppuhren');
    }

    const rev = this.rev() + 1;
    setConfig(this.db, 'liveRev', String(rev));
    this.db
      .prepare(
        `INSERT INTO live_drafts(mode, data, rev, updatedAt, userId) VALUES(?,?,?,?,?)
         ON CONFLICT(mode) DO UPDATE SET data=excluded.data, rev=excluded.rev, updatedAt=excluded.updatedAt, userId=excluded.userId`,
      )
      .run(mode, data, rev, Date.now(), userId);
    this.wake();
    return { accepted: true, rev };
  }

  /**
   * Wartet auf die nächste Änderung, höchstens `ms`. `connection` ist die Antwort an den Client:
   * bricht er die Verbindung ab, endet das Warten sofort.
   */
  wait(ms: number, connection?: { once(ev: 'close', fn: () => void): unknown; off(ev: 'close', fn: () => void): unknown }): Promise<void> {
    if (this.closing) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        connection?.off('close', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
      connection?.once('close', done);
    });
  }

  /** Weckt alle wartenden Anfragen (nach einer Änderung, einer Wiederherstellung oder beim Beenden). */
  wake(): void {
    for (const w of [...this.waiters]) w();
  }

  /** Beim Herunterfahren: wartende Anfragen sofort beantworten, keine neuen warten lassen. */
  close(): void {
    this.closing = true;
    this.wake();
  }
}
