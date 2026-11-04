import type { FehlerCounts, Wasserentnahme } from './rules/bwScoring';
import type { Assignments } from './rules/positions';

export interface Marker {
  id: string;
  label: string;
  elapsedMs: number;
}

/** B-Teil: jede Aufgabe ist ein Mini-Timer (erstes Tippen startet, zweites stoppt). */
export interface TaskTimer {
  startElapsedMs: number;
  endElapsedMs: number | null;
}

/**
 * Zustand der Stoppuhr eines Modus. Überlebt App-Neustarts, auch während die Uhr läuft, und wird mit dem Server
 * live geteilt (siehe live.ts): alle Betreuer sehen dieselbe Stoppuhr.
 */
export interface Draft {
  mode: string;
  /** Kennung des Laufs; ändert sich beim Zurücksetzen (auf jedem Gerät gleich, siehe `nextSessionId`). */
  id: string;
  isRunning: boolean;
  /** Zeitpunkt (Date.now dieses Geräts) des letzten Starts; nur gesetzt, solange die Uhr läuft. */
  startTimestamp: number | null;
  /** Bis zum letzten Stopp aufgelaufene Zeit. */
  elapsedMs: number;
  markers: Marker[];
  knotStartElapsedMs: number | null;
  knotDurationMs: number | null;
  taskTimers: Record<string, TaskTimer>;
  notes: string;
  scoringEnabled: boolean;
  targetSeconds: number | null;
  fehlerCounts: FehlerCounts;
  /** Nur Leistungsspange. */
  measuredCm: number | null;
  judgePoints: number | null;
  nullwertungIds: string[];
  /** Nur A-Teil: Wasserentnahme dieses Laufs. Fehlt bei älteren Ständen (= Saugleitung). */
  wasserentnahme?: Wasserentnahme;
  /** Die zuletzt angewendeten Eingaben (IDs), damit keine doppelt zählt, wenn Stände zusammengeführt werden. */
  opIds?: string[];
}

export interface ScoringSnapshot {
  mode: string;
  vorgabe: number;
  fehlerpunkte: number;
  istSeconds: number;
  targetSeconds: number | null;
  timeAdjust: number;
  total: number;
  fehler: { id: string; label: string; points: number; count: number; total: number }[];
}

export interface LspSnapshot {
  variante: string;
  punkte: number | null;
  basis: { art: string; sekunden?: number; zentimeter?: number; punkte?: number } | null;
  nullwertung: boolean;
  gruende: string[];
  beobachtungen: { id: string; label: string; points: number; count: number; total: number }[];
}

/** Ein gespeicherter Trainings- oder Wertungslauf. */
export interface Run {
  id: string;
  createdAt: string;
  updatedAt: string;
  mode: string;
  /** Nur A-Teil. Fehlt bei älteren Läufen. */
  wasserentnahme?: Wasserentnahme;
  totalMs: number;
  markers: Marker[];
  knotDurationMs: number | null;
  taskTimers: Record<string, TaskTimer>;
  notes: string;
  scoring: ScoringSnapshot | null;
  lsp: LspSnapshot | null;
  /** Aufstellung zum Zeitpunkt des Laufs; Namen bleiben erhalten, auch wenn das Mitglied gelöscht wird. */
  lineupSnapshot: { assignments: Assignments; memberNames: Record<string, string> };
}

export interface LineupTemplate {
  id: string;
  name: string;
  createdAt: string;
  assignments: Assignments;
}

export interface LspState {
  variante: string;
  /** Fünf Einzelbeurteilungen des Gesamteindrucks (0–4 oder noch offen). */
  gesamteindruck: (number | null)[];
}
