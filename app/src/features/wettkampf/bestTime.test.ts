import { describe, expect, it } from 'vitest';
import { bestMs, isNewBest } from './bestTime';

const run = (mode: string, totalMs: number, wasserentnahme?: 'saug' | 'hydrant') => ({ mode, totalMs, wasserentnahme });

describe('bestMs', () => {
  it('nimmt die schnellste Zeit des Modus', () => {
    expect(bestMs([run('a', 60000), run('a', 54200), run('b', 40000)], 'a')).toBe(54200);
  });
  it('ignoriert Läufe ohne Zeit und andere Modi', () => {
    expect(bestMs([run('a', 0), run('b', 1000)], 'a')).toBeNull();
  });
  it('vergleicht den A-Teil nur bei gleicher Wasserentnahme', () => {
    const runs = [run('a', 50000, 'hydrant'), run('a', 60000, 'saug')];
    expect(bestMs(runs, 'a', 'saug')).toBe(60000);
    expect(bestMs(runs, 'a', 'hydrant')).toBe(50000);
  });
  it('zählt ältere Läufe ohne Angabe zur Wasserentnahme mit', () => {
    expect(bestMs([run('a', 58000)], 'a', 'saug')).toBe(58000);
  });
});

describe('isNewBest', () => {
  it('ist beim ersten Lauf keine Bestzeit', () => expect(isNewBest(null, 50000)).toBe(false));
  it('ist schneller als die bisherige Zeit eine', () => expect(isNewBest(54200, 53900)).toBe(true));
  it('ist gleich schnell oder langsamer keine', () => {
    expect(isNewBest(54200, 54200)).toBe(false);
    expect(isNewBest(54200, 60000)).toBe(false);
  });
});
