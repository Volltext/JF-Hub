import { describe, expect, it } from 'vitest';
import { parseHolidays } from './holidays';

describe('parseHolidays', () => {
  it('liest OpenHolidays-Antworten und sortiert nach Beginn', () => {
    const raw = [
      { startDate: '2026-10-12', endDate: '2026-10-24', name: [{ language: 'DE', text: 'Herbstferien' }] },
      { startDate: '2026-03-23', endDate: '2026-04-07', name: [{ language: 'EN', text: 'Easter' }, { language: 'DE', text: 'Osterferien' }] },
      { startDate: 'x' },
    ];
    expect(parseHolidays(raw)).toEqual([
      { name: 'Osterferien', start: '2026-03-23', end: '2026-04-07' },
      { name: 'Herbstferien', start: '2026-10-12', end: '2026-10-24' },
    ]);
  });
  it('ignoriert Unsinn', () => {
    expect(parseHolidays(null)).toEqual([]);
    expect(parseHolidays({})).toEqual([]);
  });
});
