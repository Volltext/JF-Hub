import { describe, expect, it } from 'vitest';
import { applyMapping, assign, clearSection, positionMatrix, removeMember } from './lineup';
import { csvCell, runsToCsv } from './csv';
import type { Run } from './model';
import { A_PART_POSITIONS, B_PART_POSITIONS, LSP_GRUPPE_VON_A_TEIL, buildEmptyAssignments } from './rules/positions';

const base = () => buildEmptyAssignments();

describe('assign', () => {
  it('setzt und leert eine Position', () => {
    const a = assign(base(), A_PART_POSITIONS, 'a-melder', 'm1');
    expect(a['a-melder']).toBe('m1');
    expect(assign(a, A_PART_POSITIONS, 'a-melder', null)['a-melder']).toBeNull();
  });

  it('tauscht, wenn das Mitglied schon im Abschnitt sitzt', () => {
    let a = assign(base(), A_PART_POSITIONS, 'a-melder', 'm1');
    a = assign(a, A_PART_POSITIONS, 'a-maschinist', 'm2');
    a = assign(a, A_PART_POSITIONS, 'a-maschinist', 'm1');
    expect(a['a-maschinist']).toBe('m1');
    expect(a['a-melder']).toBe('m2');
  });

  it('verschiebt in einen freien Platz ohne Duplikat', () => {
    let a = assign(base(), A_PART_POSITIONS, 'a-melder', 'm1');
    a = assign(a, A_PART_POSITIONS, 'a-maschinist', 'm1');
    expect(a['a-melder']).toBeNull();
    expect(Object.values(a).filter((v) => v === 'm1')).toHaveLength(1);
  });

  it('lässt andere Abschnitte unberührt (A-Teil und B-Teil sind unabhängig)', () => {
    let a = assign(base(), A_PART_POSITIONS, 'a-melder', 'm1');
    a = assign(a, B_PART_POSITIONS, 'b-laeufer-1', 'm1');
    expect(a['a-melder']).toBe('m1');
    expect(a['b-laeufer-1']).toBe('m1');
  });
});

describe('Aufstellung: Hilfen', () => {
  it('übernimmt A-Teil in die LSP-Gruppe und lässt Leeres leer', () => {
    const a = applyMapping(assign(base(), A_PART_POSITIONS, 'a-melder', 'm1'), LSP_GRUPPE_VON_A_TEIL);
    expect(a['lsp-g-melder']).toBe('m1');
    expect(a['lsp-g-maschinist']).toBeNull();
  });

  it('leert einen Abschnitt und entfernt ein Mitglied überall', () => {
    let a = assign(base(), A_PART_POSITIONS, 'a-melder', 'm1');
    a = assign(a, B_PART_POSITIONS, 'b-laeufer-2', 'm1');
    expect(removeMember(a, 'm1')['b-laeufer-2']).toBeNull();
    expect(clearSection(a, A_PART_POSITIONS)['a-melder']).toBeNull();
    expect(clearSection(a, A_PART_POSITIONS)['b-laeufer-2']).toBe('m1');
  });
});

const run = (assignments: Record<string, string | null>, names: Record<string, string>, over: Partial<Run> = {}): Run => ({
  id: Math.random().toString(),
  createdAt: '2026-03-05T10:00:00Z',
  updatedAt: '',
  mode: 'a',
  totalMs: 88_400,
  markers: [],
  knotDurationMs: null,
  taskTimers: {},
  notes: '',
  scoring: null,
  lsp: null,
  lineupSnapshot: { assignments: { ...base(), ...assignments }, memberNames: names },
  ...over,
});

describe('positionMatrix', () => {
  const names = { m1: 'Anna', m2: 'Ben' };
  const ids = new Set(A_PART_POSITIONS.map((p) => p.id));

  it('zählt Positionen und Läufe je Mitglied, häufigste zuerst', () => {
    const rows = positionMatrix(
      [
        run({ 'a-melder': 'm1', 'a-maschinist': 'm2' }, names),
        run({ 'a-melder': 'm1' }, names),
        run({ 'a-maschinist': 'm1', 'b-laeufer-1': 'm2' }, names),
      ],
      ids,
    );
    expect(rows[0]).toMatchObject({ name: 'Anna', runs: 3 });
    expect(rows[0]!.counts.map((c) => [c.position.shortLabel, c.count])).toEqual([['Me', 2], ['Ma', 1]]);
    expect(rows[1]).toMatchObject({ name: 'Ben', runs: 1 });
  });

  it('ignoriert Positionen außerhalb des Abschnitts und unbekannte Namen werden „Unbekannt“', () => {
    const rows = positionMatrix([run({ 'a-melder': 'x9', 'b-laeufer-1': 'm1' }, names)], ids);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Unbekannt');
  });
});

describe('CSV', () => {
  it('maskiert Sonderzeichen und entschärft Formeln', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('sag "hi"')).toBe('"sag ""hi"""');
    expect(csvCell('=SUMME(A1)')).toBe("'=SUMME(A1)");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell(null)).toBe('');
    expect(csvCell(12)).toBe('12');
  });

  it('schreibt BOM, Kopfzeile und je Lauf eine Zeile', () => {
    const csv = runsToCsv([
      run({ 'a-melder': 'm1' }, { m1: 'Anna' }, { notes: 'gut;\nschnell', scoring: { mode: 'a', vorgabe: 1000, fehlerpunkte: 15, istSeconds: 88, targetSeconds: 90, timeAdjust: 0, total: 985, fehler: [] } }),
    ]);
    expect(csv.startsWith('﻿Datum;Modus')).toBe(true);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2); // Kopfzeile + ein Lauf (Zeilenumbruch in den Notizen liegt in Anführungszeichen)
    expect(csv).toContain('2026-03-05;A-Teil;88,4;15;985;90;"gut;\nschnell";Me: Anna');
  });
});
