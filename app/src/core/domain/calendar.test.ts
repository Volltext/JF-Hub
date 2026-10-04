import { describe, expect, it } from 'vitest';
import { formatTime, monthGrid, parseIso, parseTime, shiftMonth } from './calendar';

describe('monthGrid', () => {
  it('Oktober 2026 beginnt an einem Donnerstag (Montag-Woche)', () => {
    const grid = monthGrid(2026, 9);
    expect(grid[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid.flat().filter(Boolean)).toHaveLength(31);
    expect(grid.at(-1)!.includes('2026-10-31')).toBe(true);
  });

  it('Schaltjahr-Februar und Monat, der am Montag beginnt', () => {
    expect(monthGrid(2024, 1).flat().filter(Boolean)).toHaveLength(29);
    // Februar 2027 beginnt an einem Montag und hat 28 Tage → genau vier volle Wochen
    const feb = monthGrid(2027, 1);
    expect(feb).toHaveLength(4);
    expect(feb[0]![0]).toBe('2027-02-01');
  });
});

describe('shiftMonth', () => {
  it('läuft über Jahresgrenzen vor und zurück', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ y: 2027, m: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ y: 2025, m: 11 });
    expect(shiftMonth(2026, 5, -17)).toEqual({ y: 2025, m: 0 });
  });
});

describe('parseIso / Uhrzeit', () => {
  it('erkennt gültige und ungültige Daten', () => {
    expect(parseIso('2026-10-02')).toEqual({ y: 2026, m: 9, d: 2 });
    expect(parseIso('2026-02-30')).toBeNull();
    expect(parseIso('')).toBeNull();
  });

  it('liest und schreibt Uhrzeiten', () => {
    expect(parseTime('7:05')).toEqual({ h: 7, min: 5 });
    expect(parseTime('25:00')).toEqual({ h: 0, min: 0 });
    expect(parseTime('')).toEqual({ h: 0, min: 0 });
    expect(formatTime(7, 5)).toBe('07:05');
  });
});
