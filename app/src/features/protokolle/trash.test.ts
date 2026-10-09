import { describe, expect, it } from 'vitest';
import { daysLeft, isoOf, leftLabel } from './trash';

const DAY = 86_400_000;

describe('Papierkorb: Restzeit', () => {
  it('zählt die verbleibenden Tage, aufgerundet, nie unter 0', () => {
    const t = new Date(2026, 9, 1, 12, 0, 0).getTime();
    expect(daysLeft(t, 30, t)).toBe(30);
    expect(daysLeft(t, 30, t + 10 * DAY + 3600_000)).toBe(20);
    expect(daysLeft(t, 30, t + 29.5 * DAY)).toBe(1);
    expect(daysLeft(t, 30, t + 40 * DAY)).toBe(0);
  });

  it('beschriftet die Restzeit', () => {
    expect(leftLabel(30)).toBe('noch 30 Tage');
    expect(leftLabel(1)).toBe('noch 1 Tag');
    expect(leftLabel(0)).toBe('wird bald endgültig gelöscht');
  });

  it('macht aus einer Zeit ein Datum in Ortszeit', () => {
    expect(isoOf(new Date(2026, 0, 5, 23, 30).getTime())).toBe('2026-01-05');
    expect(isoOf(new Date(2026, 11, 31, 0, 5).getTime())).toBe('2026-12-31');
  });
});
