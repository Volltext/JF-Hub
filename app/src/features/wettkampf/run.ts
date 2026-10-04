import { newId, nowIso } from '@/core/domain/id';
import type { Draft, LspSnapshot, Run, ScoringSnapshot } from './model';
import { WASSERENTNAHME_LABEL, computeScore, resolveFehlerList, sumFehlerpunkte, type Wasserentnahme } from './rules/bwScoring';
import { computeLspDisziplin } from './rules/leistungsspange';
import { getMode } from './rules/modes';
import type { Assignments } from './rules/positions';
import { elapsedOf, formatClock } from './stopwatch';

/** Wertung eines Entwurfs im Bundeswettbewerb (A-/B-Teil). */
export function bwScore(d: Draft, now: number) {
  const fehlerpunkte = sumFehlerpunkte(d.mode, d.fehlerCounts);
  return computeScore(d.mode, elapsedOf(d, now), d.targetSeconds, fehlerpunkte);
}

/** Wertung einer Leistungsspangen-Disziplin aus dem Entwurf. */
export function lspWertung(d: Draft, varianteId: string, now: number) {
  return computeLspDisziplin(d.mode, varianteId, {
    totalMs: elapsedOf(d, now),
    measuredCm: d.measuredCm,
    judgePoints: d.judgePoints,
    nullwertungIds: d.nullwertungIds,
  });
}

export interface BuildRunArgs {
  now: number;
  assignments: Assignments;
  memberNames: Record<string, string>;
  lspVariante: string;
}

export function buildRun(d: Draft, { now, assignments, memberNames, lspVariante }: BuildRunArgs): Run {
  const isLsp = getMode(d.mode).competition === 'lsp';
  const totalMs = elapsedOf(d, now);
  const stamp = nowIso();

  let scoring: ScoringSnapshot | null = null;
  if (!isLsp && d.scoringEnabled) {
    scoring = { ...bwScore(d, now), fehler: resolveFehlerList(d.mode, d.fehlerCounts) };
  }

  let lsp: LspSnapshot | null = null;
  if (isLsp) {
    const w = lspWertung(d, lspVariante, now)!;
    lsp = {
      variante: lspVariante,
      punkte: w.punkte,
      basis: w.basis,
      nullwertung: w.nullwertung,
      gruende: w.gruende,
      // Beobachtungshilfe: beim Löschangriff werden Fehler nach dem A-Teil-Katalog mitgezählt.
      beobachtungen: d.mode === 'lsp-loeschangriff' ? resolveFehlerList('a', d.fehlerCounts) : [],
    };
  }

  return {
    id: newId(),
    createdAt: stamp,
    updatedAt: stamp,
    mode: d.mode,
    wasserentnahme: d.mode === 'a' ? (d.wasserentnahme ?? 'saug') : undefined,
    totalMs,
    markers: d.markers,
    knotDurationMs: d.knotDurationMs,
    taskTimers: d.taskTimers,
    notes: d.notes,
    scoring,
    lsp,
    lineupSnapshot: { assignments: { ...assignments }, memberNames },
  };
}

/** Ein Lauf ist speicherbar, sobald Zeit, Messwert oder Bewertung vorliegt. */
export function canSave(d: Draft, now: number): boolean {
  const isLsp = getMode(d.mode).competition === 'lsp';
  if (elapsedOf(d, now) > 0 && !d.isRunning) return true;
  return isLsp && (d.measuredCm !== null || d.judgePoints !== null || d.nullwertungIds.length > 0);
}

/** Titel eines Laufs: Zeiten werden nur bei Zeit-Disziplinen angezeigt (nicht bei Weite oder Bewertung). */
export function runTitle(r: { mode: string; totalMs: number; wasserentnahme?: Wasserentnahme }): string {
  const mode = getMode(r.mode);
  const name = runModeLabel(r);
  return mode.kind === 'timed' ? `${name} · ${formatClock(r.totalMs)}` : name;
}

/** Modusname inkl. Wasserentnahme bei A-Teil-Läufen, z. B. „A-Teil (Hydrant)“. */
export function runModeLabel(r: { mode: string; wasserentnahme?: Wasserentnahme }): string {
  const label = getMode(r.mode).label;
  return r.mode === 'a' && r.wasserentnahme ? `${label} (${WASSERENTNAHME_LABEL[r.wasserentnahme]})` : label;
}
