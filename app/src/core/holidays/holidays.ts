import { db } from '@/core/db/db';
import type { Holiday } from '@/core/domain/serviceSchedule';
import { IS_WEB } from '@/core/env';
import { loadConn, request } from '@/features/protokolle/http';

const KEY = 'holidays';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const API = 'https://openholidaysapi.org/SchoolHolidays';

export const STATES: { value: string; label: string }[] = [
  { value: 'BW', label: 'Baden-Württemberg' },
  { value: 'BY', label: 'Bayern' },
  { value: 'BE', label: 'Berlin' },
  { value: 'BB', label: 'Brandenburg' },
  { value: 'HB', label: 'Bremen' },
  { value: 'HH', label: 'Hamburg' },
  { value: 'HE', label: 'Hessen' },
  { value: 'MV', label: 'Mecklenburg-Vorpommern' },
  { value: 'NI', label: 'Niedersachsen' },
  { value: 'NW', label: 'Nordrhein-Westfalen' },
  { value: 'RP', label: 'Rheinland-Pfalz' },
  { value: 'SL', label: 'Saarland' },
  { value: 'SN', label: 'Sachsen' },
  { value: 'ST', label: 'Sachsen-Anhalt' },
  { value: 'SH', label: 'Schleswig-Holstein' },
  { value: 'TH', label: 'Thüringen' },
];

export interface HolidayCache {
  state: string;
  fetchedAt: number;
  items: Holiday[];
}

export async function loadHolidayCache(): Promise<HolidayCache | null> {
  const row = await db.kv.get(KEY);
  return (row?.value as HolidayCache | undefined) ?? null;
}

interface ApiItem {
  startDate: string;
  endDate: string;
  name: { language: string; text: string }[];
}

/** Antwort von OpenHolidays in unser Format bringen (rein, getestet). */
export function parseHolidays(raw: unknown): Holiday[] {
  if (!Array.isArray(raw)) return [];
  const out: Holiday[] = [];
  for (const item of raw as ApiItem[]) {
    if (typeof item?.startDate !== 'string' || typeof item.endDate !== 'string') continue;
    const name = item.name?.find((n) => n.language === 'DE')?.text ?? item.name?.[0]?.text ?? '';
    out.push({ name, start: item.startDate, end: item.endDate });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** Rohdaten der Ferien: im Browser über den eigenen Server (CSP, Datenschutz), in der App direkt von OpenHolidays. */
async function fetchRaw(state: string, year: number): Promise<unknown> {
  if (IS_WEB) return request<unknown>(await loadConn(), 'GET', `/api/holidays?state=${encodeURIComponent(state)}`);
  const url = `${API}?countryIsoCode=DE&subdivisionCode=DE-${encodeURIComponent(state)}&validFrom=${year}-01-01&validTo=${year + 1}-12-31&languageIsoCode=DE`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`Ferien-Server: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Lädt die Schulferien des Bundeslands (laufendes und nächstes Jahr) und merkt sie sich. */
export async function fetchHolidays(state: string, now = new Date()): Promise<HolidayCache> {
  const items = parseHolidays(await fetchRaw(state, now.getFullYear()));
  if (!items.length) throw new Error('Ferien-Server lieferte keine Termine.');
  const cache: HolidayCache = { state, fetchedAt: now.getTime(), items };
  await db.kv.put({ key: KEY, value: cache });
  return cache;
}

/** Aktualisiert höchstens einmal pro Woche; Fehler (kein Netz) lassen den alten Stand bestehen. */
export async function refreshHolidaysIfStale(state: string, now = new Date()): Promise<void> {
  const cache = await loadHolidayCache();
  if (cache && cache.state === state && now.getTime() - cache.fetchedAt < MAX_AGE_MS) return;
  try {
    await fetchHolidays(state, now);
  } catch {
    /* offline: alter Stand bleibt */
  }
}
