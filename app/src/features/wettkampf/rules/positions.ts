import { LSP_DISZIPLIN_IDS } from './leistungsspange';

export interface Position {
  id: string;
  label: string;
  shortLabel: string;
  section: string;
}

/** Zuordnung Position → Mitglied (oder frei). */
export type Assignments = Record<string, string | null>;

const FUNKTIONEN: [key: string, label: string, short: string][] = [
  ['gruppenfuehrer', 'Gruppenführer', 'GF'],
  ['melder', 'Melder', 'Me'],
  ['maschinist', 'Maschinist', 'Ma'],
  ['angriffstruppfuehrer', 'Angriffstruppführer', 'ATF'],
  ['angriffstruppmann', 'Angriffstruppmann', 'ATM'],
  ['wassertruppfuehrer', 'Wassertruppführer', 'WTF'],
  ['wassertruppmann', 'Wassertruppmann', 'WTM'],
  ['schlauchtruppfuehrer', 'Schlauchtruppführer', 'STF'],
  ['schlauchtruppmann', 'Schlauchtruppmann', 'STM'],
];

const fromFunktionen = (prefix: string, section: string, keys?: string[]): Position[] =>
  FUNKTIONEN.filter(([k]) => !keys || keys.includes(k)).map(([key, label, short]) => ({
    id: `${prefix}-${key}`,
    label: `${label} (${short})`,
    shortLabel: short,
    section,
  }));

export const A_PART_POSITIONS: Position[] = fromFunktionen('a', 'A-Teil');

export const B_PART_POSITIONS: Position[] = Array.from({ length: 9 }, (_, i) => ({
  id: `b-laeufer-${i + 1}`,
  label: `Läufer ${i + 1}`,
  shortLabel: `L${i + 1}`,
  section: 'B-Teil',
}));

// Leistungsspange: taktische Gliederung nach FwDV 3. Die Gruppe entspricht den Funktionen des A-Teils,
// die Staffel kommt ohne Melder und Schlauchtrupp aus. Die Brusttuch-Nummern der Übungen sind laut
// Richtlinie frei vergebbar und deshalb keine Positionen (sie stehen als Ablaufhinweis im Wissen).
export const LSP_GRUPPE_POSITIONS: Position[] = fromFunktionen('lsp-g', 'LSP-Gruppe');

export const LSP_STAFFEL_POSITIONS: Position[] = [
  { id: 'lsp-s-staffelfuehrer', label: 'Staffelführer (StF)', shortLabel: 'StF', section: 'LSP-Staffel' },
  ...fromFunktionen('lsp-s', 'LSP-Staffel', [
    'maschinist',
    'angriffstruppfuehrer',
    'angriffstruppmann',
    'wassertruppfuehrer',
    'wassertruppmann',
  ]),
];

/** Zielposition → Quellposition im A-Teil, damit eine A-Teil-Aufstellung übernommen werden kann. */
const mapFromA = (positions: Position[], overrides: Record<string, string> = {}): Record<string, string> =>
  Object.fromEntries(
    positions.map((p) => [p.id, overrides[p.id] ?? p.id.replace(/^lsp-[gs]-/, 'a-')]),
  );

export const LSP_GRUPPE_VON_A_TEIL = mapFromA(LSP_GRUPPE_POSITIONS);
export const LSP_STAFFEL_VON_A_TEIL = mapFromA(LSP_STAFFEL_POSITIONS, {
  'lsp-s-staffelfuehrer': 'a-gruppenfuehrer',
});

export const ALL_POSITIONS: Position[] = [
  ...A_PART_POSITIONS,
  ...B_PART_POSITIONS,
  ...LSP_GRUPPE_POSITIONS,
  ...LSP_STAFFEL_POSITIONS,
];

// Modus-Kennungen der Stoppuhr. Der Bundeswettbewerb hat 'a'/'b', die Leistungsspange je Disziplin einen eigenen.
export const BW_MODE_IDS = ['a', 'b'];
export const LSP_MODE_IDS = [...LSP_DISZIPLIN_IDS];
export const ALL_MODE_IDS = [...BW_MODE_IDS, ...LSP_MODE_IDS];

export const A_MODE_MARKERS = ['zu Wasser', 'Knoten Start'];
export const B_MODE_MARKERS = ['Schlauchrollen', 'L7/L8 Team', 'Anziehen'];

export const buildEmptyAssignments = (): Assignments =>
  Object.fromEntries(ALL_POSITIONS.map((p) => [p.id, null]));
