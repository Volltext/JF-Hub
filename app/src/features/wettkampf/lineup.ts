import type { Run } from './model';
import { ALL_POSITIONS, type Assignments, type Position } from './rules/positions';

/**
 * Weist einer Position ein Mitglied zu (oder macht sie frei).
 * Sitzt das Mitglied schon an einer anderen Position desselben Abschnitts, tauschen beide:
 * der bisherige Inhaber der Zielposition rückt auf den alten Platz des Mitglieds.
 */
export function assign(
  current: Assignments,
  section: Position[],
  positionId: string,
  memberId: string | null,
): Assignments {
  const next = { ...current };
  if (memberId === null) {
    next[positionId] = null;
    return next;
  }
  const previousOccupant = current[positionId] ?? null;
  const oldSpot = section.find((p) => p.id !== positionId && current[p.id] === memberId);
  if (oldSpot) next[oldSpot.id] = previousOccupant;
  next[positionId] = memberId;
  return next;
}

/** Übernimmt Zielposition ← Quellposition (z. B. A-Teil → LSP-Gruppe). */
export function applyMapping(current: Assignments, mapping: Record<string, string>): Assignments {
  const next = { ...current };
  for (const [target, source] of Object.entries(mapping)) next[target] = current[source] ?? null;
  return next;
}

export function clearSection(current: Assignments, section: Position[]): Assignments {
  const next = { ...current };
  for (const p of section) next[p.id] = null;
  return next;
}

/** Entfernt ein Mitglied aus allen Positionen (z. B. nach dem Löschen oder Deaktivieren). */
export function removeMember(current: Assignments, memberId: string): Assignments {
  return Object.fromEntries(Object.entries(current).map(([k, v]) => [k, v === memberId ? null : v]));
}

export interface MatrixRow {
  memberId: string;
  name: string;
  runs: number;
  /** Positionen absteigend nach Häufigkeit. */
  counts: { position: Position; count: number }[];
}

/**
 * Wie oft stand welches Mitglied auf welcher Position – über die übergebenen Läufe,
 * anhand der gespeicherten Schnappschüsse. Positionen werden nur gezählt, wenn sie zu `positionIds` gehören.
 */
export function positionMatrix(runs: Run[], positionIds: Set<string>): MatrixRow[] {
  const rows = new Map<string, MatrixRow>();
  const byId = new Map(ALL_POSITIONS.map((p) => [p.id, p]));

  for (const run of runs) {
    const seen = new Set<string>();
    for (const [posId, memberId] of Object.entries(run.lineupSnapshot.assignments)) {
      const position = byId.get(posId);
      if (!memberId || !position || !positionIds.has(posId)) continue;
      let row = rows.get(memberId);
      if (!row) {
        row = { memberId, name: run.lineupSnapshot.memberNames[memberId] ?? 'Unbekannt', runs: 0, counts: [] };
        rows.set(memberId, row);
      }
      if (!seen.has(memberId)) {
        row.runs++;
        seen.add(memberId);
      }
      const entry = row.counts.find((c) => c.position.id === posId);
      if (entry) entry.count++;
      else row.counts.push({ position, count: 1 });
    }
  }
  for (const row of rows.values()) row.counts.sort((a, b) => b.count - a.count);
  return [...rows.values()].sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name, 'de'));
}
