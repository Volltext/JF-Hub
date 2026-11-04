import type { Draft } from './model';
import { addFehler, addSplit, removeFehler, removeMarker, reset, resetTaskTimer, setNullwertung, start, stop } from './stopwatch';

/**
 * Eingaben an der Stoppuhr als Daten statt als Funktion: sie lassen sich speichern (offline, über einen Neustart
 * hinweg) und auf einen neueren Stand vom Server erneut anwenden, wenn ein anderes Gerät dazwischen etwas geändert hat.
 */
export type DraftOp =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'reset' }
  | { type: 'split'; label: string; markerId: string }
  | { type: 'removeMarker'; markerId: string }
  | { type: 'resetTask'; label: string }
  | { type: 'fehler'; errorId: string; delta: 1 | -1 }
  | { type: 'nullwertung'; id: string; on: boolean }
  | { type: 'set'; patch: DraftPatch };

/** Felder, die direkt gesetzt werden (Eingabefelder und Schalter). Gesetzt statt umgeschaltet: zweimal „an“ bleibt „an“. */
export type DraftPatch = Partial<Pick<Draft, 'notes' | 'scoringEnabled' | 'targetSeconds' | 'measuredCm' | 'judgePoints' | 'wasserentnahme'>>;

const PATCH_KEYS = ['notes', 'scoringEnabled', 'targetSeconds', 'measuredCm', 'judgePoints', 'wasserentnahme'] as const;

export interface PendingOp {
  id: string;
  /** Lauf (`Draft.id`), auf den sich die Eingabe bezieht. Gehört der Stand inzwischen zu einem anderen Lauf, entfällt sie. */
  session: string;
  /** Zeitpunkt der Eingabe in Gerätezeit (Date.now). */
  at: number;
  op: DraftOp;
}

/** So viele zuletzt angewendete Eingaben merkt sich ein Stand (reicht für alles, was gleichzeitig unterwegs sein kann). */
const KEEP_OP_IDS = 100;

/** Wendet eine Eingabe an. Bewirkt sie nichts (z. B. Start bei laufender Uhr), kommt dasselbe Objekt zurück. */
export function applyOp(d: Draft, op: DraftOp, at: number): Draft {
  switch (op.type) {
    case 'start':
      return start(d, at);
    case 'stop':
      return stop(d, at);
    case 'reset':
      return reset(d);
    case 'split':
      return addSplit(d, op.label, at, op.markerId);
    case 'removeMarker':
      return removeMarker(d, op.markerId);
    case 'resetTask':
      return resetTaskTimer(d, op.label);
    case 'fehler':
      return op.delta > 0 ? addFehler(d, op.errorId) : removeFehler(d, op.errorId);
    case 'nullwertung':
      return setNullwertung(d, op.id, op.on);
    case 'set': {
      const changes = PATCH_KEYS.filter((k) => k in op.patch && op.patch[k] !== d[k]);
      if (!changes.length) return d;
      return { ...d, ...Object.fromEntries(changes.map((k) => [k, op.patch[k]])) };
    }
    default:
      return d; // unbekannte Eingabe (z. B. aus einer neueren App-Version gespeichert)
  }
}

/**
 * Wendet eine offene Eingabe an und merkt ihre ID im Stand. Unverändert, wenn sie schon enthalten ist,
 * zu einem anderen Lauf gehört oder nichts bewirkt.
 */
export function applyPending(d: Draft, p: PendingOp): Draft {
  if (p.session !== d.id || d.opIds?.includes(p.id)) return d;
  const next = applyOp(d, p.op, p.at);
  if (next === d) return d;
  return { ...next, opIds: [...(d.opIds ?? []), p.id].slice(-KEEP_OP_IDS) };
}

/**
 * Setzt offene Eingaben auf einen (neueren) Stand. Zurück kommen der neue Stand und die Eingaben, die noch etwas
 * bewirken; was der Stand schon enthält, zu einem vergangenen Lauf gehört oder nichts mehr ändert, fällt weg.
 */
export function rebase(base: Draft, ops: PendingOp[]): { draft: Draft; ops: PendingOp[] } {
  let draft = base;
  const kept: PendingOp[] = [];
  for (const p of ops) {
    const next = applyPending(draft, p);
    if (next === draft) continue;
    kept.push(p);
    draft = next;
  }
  return { draft, ops: kept };
}

/**
 * Hängt eine Eingabe an die Warteschlange. Tippen in ein Feld erzeugt viele `set`-Eingaben hintereinander: die
 * letzte ersetzt dann die vorige (solange diese noch nicht unterwegs ist), damit die Schlange klein bleibt.
 */
export function enqueue(ops: PendingOp[], p: PendingOp, inFlight: ReadonlySet<string>): PendingOp[] {
  const last = ops[ops.length - 1];
  if (
    last &&
    !inFlight.has(last.id) &&
    last.session === p.session &&
    last.op.type === 'set' &&
    p.op.type === 'set' &&
    sameKeys(last.op.patch, p.op.patch)
  ) {
    return [...ops.slice(0, -1), p];
  }
  return [...ops, p];
}

const sameKeys = (a: object, b: object) => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
};
