// Registry der unterstützten Wettbewerbe.
//
// Die App kennt zwei Wettbewerbe, die sich denselben Bildschirm teilen:
//   • Bundeswettbewerb (A-Teil / B-Teil)  → Wertung nach `scoring.js`
//   • Leistungsspange (fünf Disziplinen)  → Wertung nach `leistungsspange.js`
//
// Der Wettbewerb ist eine eigene Achse *neben* dem Modus: `mode` bleibt der
// Schlüssel eines Stoppuhr-Drafts und wurde nur um die LSP-Disziplinen erweitert.
// Damit laufen die neuen Disziplinen ohne Sonderweg durch die bestehende Sync-,
// Versions- und Controller-Mechanik.
//
// Diese Datei ist die einzige Stelle, die beide Wettbewerbe kennt — überall sonst
// wird über `MODES` bzw. die Helfer unten aufgelöst statt auf 'a'/'b' verzweigt.

import { A_MODE_MARKERS, B_MODE_MARKERS, BW_MODE_IDS, LSP_MODE_IDS } from './positions';
import { LSP_DISZIPLINEN, getLspDisziplin } from './leistungsspange';
import type { Wasserentnahme } from './bwScoring';

export const COMPETITIONS = [
  { id: 'bw', label: 'Bundeswettbewerb', shortLabel: 'BW', modes: BW_MODE_IDS },
  { id: 'lsp', label: 'Leistungsspange', shortLabel: 'LSP', modes: LSP_MODE_IDS }
];

export const COMPETITION_IDS = COMPETITIONS.map((competition) => competition.id);
export const DEFAULT_COMPETITION_ID = 'bw';

export interface ModeInfo {
  id: string;
  competition: string;
  label: string;
  shortLabel: string;
  kind: 'timed' | 'measured' | 'judged';
  markers: string[];
  hasKnotTimer: boolean;
  markersAreTasks: boolean;
}

const BW_MODES: Record<string, ModeInfo> = {
  a: {
    id: 'a',
    competition: 'bw',
    label: 'A-Teil',
    shortLabel: 'A',
    kind: 'timed',
    markers: A_MODE_MARKERS,
    // Der A-Teil ist der einzige Modus mit separater Knotenzeit.
    hasKnotTimer: true,
    // Marker sind Zwischenzeiten; im B-Teil dagegen Aufgaben-Timer mit Start/Stopp.
    markersAreTasks: false
  },
  b: {
    id: 'b',
    competition: 'bw',
    label: 'B-Teil',
    shortLabel: 'B',
    kind: 'timed',
    markers: B_MODE_MARKERS,
    hasKnotTimer: false,
    markersAreTasks: true
  }
};

const LSP_MODES: Record<string, ModeInfo> = Object.fromEntries(
  LSP_DISZIPLINEN.map((disziplin) => [
    disziplin.id,
    {
      id: disziplin.id,
      competition: 'lsp',
      label: disziplin.label,
      shortLabel: disziplin.shortLabel,
      kind: disziplin.kind,
      markers: [],
      hasKnotTimer: false,
      markersAreTasks: false
    }
  ])
);

export const MODES: Record<string, ModeInfo> = { ...BW_MODES, ...LSP_MODES };

export const STOPWATCH_MODE_IDS = Object.keys(MODES);

export const DEFAULT_MODE_ID = 'a';

export function isKnownMode(modeId: unknown): boolean {
  return typeof modeId === 'string' && Object.prototype.hasOwnProperty.call(MODES, modeId);
}

export function getMode(modeId: string): ModeInfo {
  return (isKnownMode(modeId) ? MODES[modeId] : MODES[DEFAULT_MODE_ID])!;
}

// Alte Läufe kennen nur 'a'/'b'; ein unbekannter Wert fällt bewusst auf den A-Teil
// zurück statt eine leere Bezeichnung in Historie und CSV-Export zu schreiben.
export function getModeLabel(modeId: string): string {
  return getMode(modeId).label;
}

export function getCompetitionForMode(modeId: string): string {
  return getMode(modeId).competition;
}

export function getCompetition(competitionId: string) {
  return COMPETITIONS.find((competition) => competition.id === competitionId) ?? COMPETITIONS[0]!;
}

export function isKnownCompetition(competitionId: string): boolean {
  return COMPETITION_IDS.includes(competitionId);
}

export function getModesForCompetition(competitionId: string): ModeInfo[] {
  return getCompetition(competitionId).modes.map((modeId) => MODES[modeId]!);
}

/** Zwischenzeiten-Knöpfe. Im A-Teil hängen sie von der Wasserentnahme ab: bei der Saugleitung „zu Wasser“, beim Hydrant „Wasser marsch“. */
export function markersFor(modeId: string, variant: Wasserentnahme = 'saug'): string[] {
  if (modeId === 'a') return [variant === 'hydrant' ? 'Wasser marsch' : 'zu Wasser', 'Knoten Start'];
  return getMarkersForMode(modeId);
}

export function getMarkersForMode(modeId: string): string[] {
  return getMode(modeId).markers;
}

// Die Disziplin-Beschreibung zu einem Modus — null für den Bundeswettbewerb.
export function getDisziplinForMode(modeId: string) {
  return getLspDisziplin(modeId);
}
