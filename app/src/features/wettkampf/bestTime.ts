import type { Run } from './model';

/** Schnellste gespeicherte Zeit eines Modus (nur Läufe mit Zeit); beim A-Teil nur mit gleicher Wasserentnahme, weil die Wege verschieden lang sind. */
export function bestMs(runs: readonly Pick<Run, 'mode' | 'totalMs' | 'wasserentnahme'>[], mode: string, wasserentnahme?: string): number | null {
  let best: number | null = null;
  for (const r of runs) {
    if (r.mode !== mode || !(r.totalMs > 0)) continue;
    if (mode === 'a' && wasserentnahme && r.wasserentnahme && r.wasserentnahme !== wasserentnahme) continue;
    if (best === null || r.totalMs < best) best = r.totalMs;
  }
  return best;
}

/** Neue Bestzeit nur gegen eine vorhandene Zeit: der erste Lauf ist keine „Bestzeit“, sondern der Anfang. */
export const isNewBest = (previous: number | null, ms: number): boolean => previous !== null && ms > 0 && ms < previous;
