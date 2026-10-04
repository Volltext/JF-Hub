import { db } from '@/core/db/db';
import { newId, nowIso } from '@/core/domain/id';
import type { Draft, LineupTemplate, LspState, Run } from './model';
import { buildRun } from './run';
import type { Wasserentnahme } from './rules/bwScoring';
import { buildEmptyAssignments, type Assignments } from './rules/positions';
import { emptyDraft, reset } from './stopwatch';

/** Persistenz des Wettkampf-Moduls. Kleine Zustände liegen im kv-Speicher, Läufe und Vorlagen in Tabellen. */

const draftKey = (mode: string) => `draft.${mode}`;
const LINEUP_KEY = 'lineup.current';
const LSP_KEY = 'lsp.state';

const VARIANT_KEY = 'wettkampf.wasserentnahme';

export async function loadWasserentnahme(): Promise<Wasserentnahme> {
  return ((await db.kv.get(VARIANT_KEY))?.value as Wasserentnahme | undefined) ?? 'saug';
}

export const saveWasserentnahme = (v: Wasserentnahme) => db.kv.put({ key: VARIANT_KEY, value: v });

export const DEFAULT_LSP: LspState = { variante: 'gruppe', gesamteindruck: [null, null, null, null, null] };

export async function loadDraft(mode: string): Promise<Draft> {
  const row = await db.kv.get(draftKey(mode));
  return { ...emptyDraft(mode), ...((row?.value as Partial<Draft>) ?? {}), mode };
}

export const saveDraft = (d: Draft) => db.kv.put({ key: draftKey(d.mode), value: d });

export async function loadLineup(): Promise<Assignments> {
  const row = await db.kv.get(LINEUP_KEY);
  // Neue Positionen (spätere App-Versionen) fehlen in alten Daten und werden als frei ergänzt.
  return { ...buildEmptyAssignments(), ...((row?.value as Assignments) ?? {}) };
}

export const saveLineup = (a: Assignments) => db.kv.put({ key: LINEUP_KEY, value: a });

export async function loadLsp(): Promise<LspState> {
  const row = await db.kv.get(LSP_KEY);
  return { ...DEFAULT_LSP, ...((row?.value as Partial<LspState>) ?? {}) };
}

export const saveLsp = (s: LspState) => db.kv.put({ key: LSP_KEY, value: s });

export const templateRepo = {
  async add(name: string, assignments: Assignments): Promise<LineupTemplate> {
    const t: LineupTemplate = { id: newId(), name: name.trim() || 'Vorlage', createdAt: nowIso(), assignments };
    await db.lineupTemplates.add(t);
    return t;
  },
  remove: (id: string) => db.lineupTemplates.delete(id),
};

export const runRepo = {
  /** Speichert den Lauf mit der aktuellen Aufstellung und setzt die Stoppuhr zurück. */
  async saveFromDraft(d: Draft, lspVariante: string, now = Date.now()): Promise<Run> {
    const [assignments, members] = await Promise.all([loadLineup(), db.members.toArray()]);
    const run = buildRun(d, {
      now,
      assignments,
      memberNames: Object.fromEntries(members.map((m) => [m.id, m.name])),
      lspVariante,
    });
    await db.runs.add(run);
    await saveDraft(reset(d));
    return run;
  },
  updateNotes: (id: string, notes: string) => db.runs.update(id, { notes, updatedAt: nowIso() }),
  remove: (id: string) => db.runs.delete(id),
};
