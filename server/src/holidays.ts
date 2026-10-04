/**
 * Schulferien für die Dienst-Erinnerung. Der Server holt sie von openholidaysapi.org und gibt sie an die Clients weiter:
 * so brauchen Browser-Clients keinen Zugriff auf Fremdserver (Content-Security-Policy) und die Anfragen der Geräte
 * (IP-Adressen) gehen nicht an den Drittanbieter.
 */
export const STATE_CODES = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'];

const API = 'https://openholidaysapi.org/SchoolHolidays';
const MAX_AGE_MS = 24 * 3_600_000;

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class HolidayCache {
  private cache = new Map<string, { at: number; data: unknown }>();
  constructor(private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  async get(state: string, now = new Date()): Promise<unknown> {
    if (!STATE_CODES.includes(state)) throw new Error('Unbekanntes Bundesland');
    const y = now.getFullYear();
    const key = `${state}:${y}`;
    const hit = this.cache.get(key);
    if (hit && now.getTime() - hit.at < MAX_AGE_MS) return hit.data;
    const url = `${API}?countryIsoCode=DE&subdivisionCode=DE-${state}&validFrom=${y}-01-01&validTo=${y + 1}-12-31&languageIsoCode=DE`;
    try {
      const res = await this.fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Ferien-Dienst: HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) throw new Error('Ferien-Dienst lieferte keine Termine');
      this.cache.set(key, { at: now.getTime(), data });
      return data;
    } catch (e) {
      if (hit) return hit.data; // lieber veraltet als gar nichts
      throw e;
    }
  }
}
