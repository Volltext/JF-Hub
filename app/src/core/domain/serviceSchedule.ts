import { formatTime, parseIso, parseTime, toIso } from './calendar';

/** Schulferien-Abschnitt; `start`/`end` als YYYY-MM-DD, beide Tage eingeschlossen. */
export interface Holiday {
  name: string;
  start: string;
  end: string;
}

/** Von Hand gesetzte Saison-Grenzen; gelten nur für das Jahr, in dem das Datum liegt. */
export interface SeasonOverride {
  /** Letzter Tag der Osterferien. */
  from: string | null;
  /** Erster Tag der Herbstferien. */
  to: string | null;
}

export interface ServiceConfig {
  /** 0 = Sonntag … 6 = Samstag (wie `Date.getDay`). */
  weekday: number;
  /** Beginn zwischen Osterferien und Herbstferien. */
  timeSeason: string;
  /** Beginn sonst. */
  timeOffSeason: string;
  leadMinutes: number;
  /** Dienste in den Schulferien auslassen. */
  skipHolidays: boolean;
  holidays: Holiday[];
  override: SeasonOverride;
}

export interface ServiceSlot {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  start: string;
  /** Zeitpunkt der Erinnerung (Beginn minus Vorlauf). */
  remindAt: Date;
}

const yearOf = (iso: string): number => Number(iso.slice(0, 4));

/**
 * Saison-Fenster eines Jahres: von „Ende der Osterferien“ bis „Beginn der Herbstferien“ (beide Tage selbst
 * liegen außerhalb). Fehlt eine Grenze, ist sie `null`.
 */
export function seasonWindow(
  year: number,
  holidays: Holiday[],
  override: SeasonOverride,
): { from: string | null; to: string | null } {
  const easterEnds = holidays.filter((h) => /oster/i.test(h.name) && yearOf(h.end) === year).map((h) => h.end);
  const autumnStarts = holidays.filter((h) => /herbst/i.test(h.name) && yearOf(h.start) === year).map((h) => h.start);
  const from = override.from && yearOf(override.from) === year ? override.from : (easterEnds.sort().at(-1) ?? null);
  const to = override.to && yearOf(override.to) === year ? override.to : (autumnStarts.sort()[0] ?? null);
  return { from, to };
}

export function isInSeason(dateIso: string, holidays: Holiday[], override: SeasonOverride): boolean {
  const { from, to } = seasonWindow(yearOf(dateIso), holidays, override);
  return from !== null && to !== null && dateIso > from && dateIso < to;
}

export function isInHoliday(dateIso: string, holidays: Holiday[]): boolean {
  return holidays.some((h) => dateIso >= h.start && dateIso <= h.end);
}

/** Beginn des Dienstes an diesem Tag („HH:MM“). Ohne Ferien-Daten gilt die Zeit außerhalb der Saison. */
export function startTimeFor(dateIso: string, cfg: ServiceConfig): string {
  return isInSeason(dateIso, cfg.holidays, cfg.override) ? cfg.timeSeason : cfg.timeOffSeason;
}

/**
 * Die nächsten Dienste ab `now`, deren Erinnerung noch in der Zukunft liegt.
 * Sucht höchstens `maxDays` Tage voraus.
 */
export function upcomingServices(now: Date, cfg: ServiceConfig, count: number, maxDays = 400): ServiceSlot[] {
  const out: ServiceSlot[] = [];
  for (let i = 0; i < maxDays && out.length < count; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (day.getDay() !== cfg.weekday) continue;
    const date = toIso(day.getFullYear(), day.getMonth(), day.getDate());
    if (cfg.skipHolidays && isInHoliday(date, cfg.holidays)) continue;
    const start = startTimeFor(date, cfg);
    const { h, min } = parseTime(start);
    const remindAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, min - cfg.leadMinutes, 0, 0);
    if (remindAt.getTime() <= now.getTime()) continue;
    out.push({ date, start: formatTime(h, min), remindAt });
  }
  return out;
}

/** Stabile Benachrichtigungs-ID eines Dienst-Termins (positiv und unter 2^31). */
export function serviceNotificationId(dateIso: string): number {
  const p = parseIso(dateIso);
  return 2_000_000_000 + (p ? (p.y - 2000) * 10000 + (p.m + 1) * 100 + p.d : 0);
}
