import { newId } from '@/core/domain/id';
import type { Draft } from './model';

/** Reine Zustandsübergänge der Stoppuhr. `now` wird übergeben, damit alles ohne Uhr testbar ist. */

export const KNOT_START = 'Knoten Start';

export function emptyDraft(mode: string): Draft {
  return {
    mode,
    isRunning: false,
    startTimestamp: null,
    elapsedMs: 0,
    markers: [],
    knotStartElapsedMs: null,
    knotDurationMs: null,
    taskTimers: {},
    notes: '',
    scoringEnabled: false,
    targetSeconds: null,
    fehlerCounts: {},
    measuredCm: null,
    judgePoints: null,
    nullwertungIds: [],
  };
}

export function elapsedOf(d: Draft, now: number): number {
  return d.isRunning && d.startTimestamp !== null ? d.elapsedMs + Math.max(0, now - d.startTimestamp) : d.elapsedMs;
}

export function start(d: Draft, now: number): Draft {
  return d.isRunning ? d : { ...d, isRunning: true, startTimestamp: now };
}

export function stop(d: Draft, now: number): Draft {
  if (!d.isRunning) return d;
  const elapsedMs = elapsedOf(d, now);
  // Knotenzeit des A-Teils: vom Knotenstart bis zum Stopp.
  const knotDurationMs =
    d.mode === 'a' && d.knotStartElapsedMs !== null && d.knotDurationMs === null
      ? Math.max(0, elapsedMs - d.knotStartElapsedMs)
      : d.knotDurationMs;
  return { ...d, isRunning: false, startTimestamp: null, elapsedMs, knotDurationMs };
}

/** Setzt Zeit, Marker und Messwerte zurück. Wertungs-Einstellungen (Soll-Zeit, an/aus) bleiben. */
export function reset(d: Draft): Draft {
  return { ...emptyDraft(d.mode), scoringEnabled: d.scoringEnabled, targetSeconds: d.targetSeconds, wasserentnahme: d.wasserentnahme };
}

export function hasData(d: Draft, now: number): boolean {
  return (
    elapsedOf(d, now) > 0 ||
    d.markers.length > 0 ||
    d.knotStartElapsedMs !== null ||
    Object.keys(d.taskTimers).length > 0 ||
    Object.keys(d.fehlerCounts).length > 0 ||
    d.measuredCm !== null ||
    d.judgePoints !== null ||
    d.nullwertungIds.length > 0
  );
}

/**
 * Zwischenzeit bzw. Aufgaben-Timer. Wirkt nur bei laufender Uhr.
 * B-Teil: erstes Tippen startet die Aufgabe, zweites stoppt sie, danach passiert nichts mehr.
 * A-Teil: „Knoten Start“ kann nur einmal gesetzt werden, andere Marker beliebig oft.
 */
export function addSplit(d: Draft, label: string, now: number): Draft {
  if (!d.isRunning) return d;
  const elapsed = elapsedOf(d, now);

  if (d.mode === 'b') {
    const existing = d.taskTimers[label];
    if (!existing) return { ...d, taskTimers: { ...d.taskTimers, [label]: { startElapsedMs: elapsed, endElapsedMs: null } } };
    if (existing.endElapsedMs === null)
      return { ...d, taskTimers: { ...d.taskTimers, [label]: { ...existing, endElapsedMs: elapsed } } };
    return d;
  }

  if (label === KNOT_START && d.knotStartElapsedMs !== null) return d;
  const marker = { id: newId(), label, elapsedMs: elapsed };
  return {
    ...d,
    markers: [marker, ...d.markers],
    knotStartElapsedMs: label === KNOT_START ? elapsed : d.knotStartElapsedMs,
  };
}

/** Entfernt eine Zwischenzeit; wird „Knoten Start“ entfernt, wird auch die Knotenmessung zurückgesetzt. */
export function removeMarker(d: Draft, markerId: string): Draft {
  const target = d.markers.find((m) => m.id === markerId);
  if (!target) return d;
  const isKnot = target.label === KNOT_START;
  return {
    ...d,
    markers: d.markers.filter((m) => m.id !== markerId),
    knotStartElapsedMs: isKnot ? null : d.knotStartElapsedMs,
    knotDurationMs: isKnot ? null : d.knotDurationMs,
  };
}

export function resetTaskTimer(d: Draft, label: string): Draft {
  if (!d.taskTimers[label]) return d;
  const { [label]: _removed, ...rest } = d.taskTimers;
  return { ...d, taskTimers: rest };
}

export function addFehler(d: Draft, errorId: string): Draft {
  return { ...d, fehlerCounts: { ...d.fehlerCounts, [errorId]: (d.fehlerCounts[errorId] ?? 0) + 1 } };
}

export function removeFehler(d: Draft, errorId: string): Draft {
  const current = d.fehlerCounts[errorId] ?? 0;
  if (current <= 0) return d;
  const { [errorId]: _gone, ...rest } = d.fehlerCounts;
  return { ...d, fehlerCounts: current > 1 ? { ...rest, [errorId]: current - 1 } : rest };
}

export function toggleNullwertung(d: Draft, id: string): Draft {
  return {
    ...d,
    nullwertungIds: d.nullwertungIds.includes(id) ? d.nullwertungIds.filter((x) => x !== id) : [...d.nullwertungIds, id],
  };
}

/** Eingabemaske für Zeiten: nur Ziffern, höchstens vier, als „mm:ss“. */
export function maskTime(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, -2)}:${digits.slice(-2)}` : digits;
}

/** „mm:ss“ bzw. reine Sekunden → Sekunden; null bei leerer oder ungültiger Eingabe. */
export function parseTargetSeconds(masked: string): number | null {
  if (!masked) return null;
  const [a, b] = masked.split(':');
  const seconds = b === undefined ? Number(a) : Number(a) * 60 + Number(b);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function formatClock(ms: number, tenths = true): string {
  const total = Math.max(0, Math.floor(ms / (tenths ? 100 : 1000)));
  const t = tenths ? total % 10 : 0;
  const s = Math.floor(tenths ? total / 10 : total);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return tenths ? `${mm}:${ss},${t}` : `${mm}:${ss}`;
}
