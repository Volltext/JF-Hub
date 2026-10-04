import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { loadSettings, type Settings } from '@/core/settings/settings';
import type { ServiceConfig } from '@/core/domain/serviceSchedule';
import { loadHolidayCache, type HolidayCache } from './holidays';

export function toServiceConfig(s: Settings, cache: HolidayCache | null): ServiceConfig {
  return {
    weekday: s.serviceWeekday,
    timeSeason: s.serviceTimeSeason,
    timeOffSeason: s.serviceTimeOffSeason,
    leadMinutes: s.serviceReminderLead,
    skipHolidays: s.serviceSkipHolidays,
    // Ein Cache eines anderen Bundeslands darf nicht verwendet werden.
    holidays: cache && cache.state === s.serviceState ? cache.items : [],
    override: { from: s.serviceSeasonFrom, to: s.serviceSeasonTo },
  };
}

/** Einstellungen und Ferien-Cache als Dienst-Konfiguration (null, solange geladen wird). */
export function useServiceConfig(): { settings: Settings; cache: HolidayCache | null; config: ServiceConfig } | null {
  const settings = useLiveQuery(loadSettings, []);
  const cache = useLiveQuery(async () => (await loadHolidayCache()) ?? null, []);
  // Stabile Identität, solange sich Einstellungen und Cache nicht ändern (Effekte hängen daran).
  return useMemo(
    () => (!settings || cache === undefined ? null : { settings, cache, config: toServiceConfig(settings, cache) }),
    [settings, cache],
  );
}
