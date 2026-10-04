import type { Run } from './model';
import { runModeLabel } from './run';
import { ALL_POSITIONS } from './rules/positions';

/**
 * CSV-Zelle. Zellen, die mit = + - @ beginnen, werden entschärft (Formel-Injektion in Excel),
 * Anführungszeichen, Semikolon und Zeilenumbrüche korrekt maskiert.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const seconds = (ms: number) => (ms / 1000).toFixed(1).replace('.', ',');

const HEADER = ['Datum', 'Modus', 'Zeit (s)', 'Fehlerpunkte', 'Wertung', 'Soll-Zeit (s)', 'Notizen', 'Aufstellung'];

export function runsToCsv(runs: Run[]): string {
  const posLabel = new Map(ALL_POSITIONS.map((p) => [p.id, p.shortLabel]));
  const lines = runs.map((r) => {
    const lineup = Object.entries(r.lineupSnapshot.assignments)
      .filter(([, m]) => m)
      .map(([pos, m]) => `${posLabel.get(pos) ?? pos}: ${r.lineupSnapshot.memberNames[m!] ?? '?'}`)
      .join(', ');
    const wertung = r.scoring ? r.scoring.total : r.lsp ? (r.lsp.punkte ?? '') : '';
    return [
      r.createdAt.slice(0, 10),
      runModeLabel(r),
      seconds(r.totalMs),
      r.scoring?.fehlerpunkte ?? '',
      wertung,
      r.scoring?.targetSeconds ?? '',
      r.notes,
      lineup,
    ]
      .map(csvCell)
      .join(';');
  });
  // BOM, damit Excel UTF-8 (Umlaute) erkennt.
  return '﻿' + [HEADER.join(';'), ...lines].join('\r\n');
}
