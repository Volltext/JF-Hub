import { describe, expect, it } from 'vitest';
import {
  isInSeason,
  seasonWindow,
  serviceNotificationId,
  startTimeFor,
  upcomingServices,
  type Holiday,
  type ServiceConfig,
} from './serviceSchedule';

// Niedersachsen 2026 (Auszug)
const HOLIDAYS: Holiday[] = [
  { name: 'Osterferien', start: '2026-03-23', end: '2026-04-07' },
  { name: 'Sommerferien', start: '2026-07-02', end: '2026-08-12' },
  { name: 'Herbstferien', start: '2026-10-12', end: '2026-10-24' },
  { name: 'Weihnachtsferien', start: '2026-12-23', end: '2027-01-09' },
];

const cfg = (over: Partial<ServiceConfig> = {}): ServiceConfig => ({
  weekday: 1,
  timeSeason: '17:30',
  timeOffSeason: '18:00',
  leadMinutes: 5,
  skipHolidays: false,
  holidays: HOLIDAYS,
  override: { from: null, to: null },
  ...over,
});

describe('seasonWindow', () => {
  it('nimmt Ende der Osterferien und Beginn der Herbstferien des Jahres', () => {
    expect(seasonWindow(2026, HOLIDAYS, { from: null, to: null })).toEqual({ from: '2026-04-07', to: '2026-10-12' });
  });
  it('ohne Daten gibt es keine Grenzen', () => {
    expect(seasonWindow(2030, HOLIDAYS, { from: null, to: null })).toEqual({ from: null, to: null });
  });
  it('Überschreibung gilt nur im eigenen Jahr', () => {
    const o = { from: '2026-04-10', to: null };
    expect(seasonWindow(2026, HOLIDAYS, o).from).toBe('2026-04-10');
    expect(seasonWindow(2027, [], o).from).toBeNull();
  });
});

describe('startTimeFor', () => {
  it('Tag nach dem Ende der Osterferien ist Saison', () => {
    expect(isInSeason('2026-04-07', HOLIDAYS, { from: null, to: null })).toBe(false);
    expect(startTimeFor('2026-04-13', cfg())).toBe('17:30');
  });
  it('vor den Herbstferien 17:30, ab Herbstferienbeginn 18:00', () => {
    expect(startTimeFor('2026-10-05', cfg())).toBe('17:30');
    expect(startTimeFor('2026-10-12', cfg())).toBe('18:00');
  });
  it('Winter und Anfang des Jahres 18:00', () => {
    expect(startTimeFor('2026-01-12', cfg())).toBe('18:00');
    expect(startTimeFor('2026-11-02', cfg())).toBe('18:00');
  });
  it('ohne Ferien-Daten 18:00', () => {
    expect(startTimeFor('2026-06-01', cfg({ holidays: [] }))).toBe('18:00');
  });
});

describe('upcomingServices', () => {
  it('liefert Montage mit Erinnerung 5 Minuten vorher', () => {
    const slots = upcomingServices(new Date(2026, 9, 4, 12, 0), cfg(), 3);
    expect(slots.map((s) => [s.date, s.start])).toEqual([
      ['2026-10-05', '17:30'],
      ['2026-10-12', '18:00'],
      ['2026-10-19', '18:00'],
    ]);
    expect(slots[0]!.remindAt).toEqual(new Date(2026, 9, 5, 17, 25));
  });
  it('lässt eine bereits vergangene Erinnerung heute aus', () => {
    const slots = upcomingServices(new Date(2026, 9, 5, 17, 26), cfg(), 1);
    expect(slots[0]!.date).toBe('2026-10-12');
  });
  it('heute vor der Erinnerung zählt noch', () => {
    const slots = upcomingServices(new Date(2026, 9, 5, 17, 24), cfg(), 1);
    expect(slots[0]!.date).toBe('2026-10-05');
  });
  it('kann Ferien auslassen', () => {
    const slots = upcomingServices(new Date(2026, 9, 6, 8, 0), cfg({ skipHolidays: true }), 2);
    expect(slots.map((s) => s.date)).toEqual(['2026-10-26', '2026-11-02']);
  });
  it('Jahreswechsel', () => {
    const slots = upcomingServices(new Date(2026, 11, 28, 8, 0), cfg(), 2);
    expect(slots.map((s) => s.date)).toEqual(['2026-12-28', '2027-01-04']);
  });
});

describe('serviceNotificationId', () => {
  it('ist stabil, positiv und passt in 31 Bit', () => {
    const id = serviceNotificationId('2026-10-05');
    expect(id).toBe(serviceNotificationId('2026-10-05'));
    expect(id).toBeGreaterThan(0);
    expect(id).toBeLessThan(2 ** 31);
    expect(id).not.toBe(serviceNotificationId('2026-10-12'));
  });
});
