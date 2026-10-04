import { db } from '@/core/db/db';

export type ThemeMode = 'auto' | 'dark' | 'light';

export interface Settings {
  theme: ThemeMode;
  /** Dienst-Erinnerung (wöchentlich, 0 = Sonntag … 6 = Samstag). */
  serviceReminderEnabled: boolean;
  serviceWeekday: number;
  /** Beginn zwischen den Osterferien und den Herbstferien. */
  serviceTimeSeason: string;
  /** Beginn sonst. */
  serviceTimeOffSeason: string;
  /** Minuten vor Beginn. */
  serviceReminderLead: number;
  /** Bundesland als Kürzel (NI, BY, …) für die Ferientermine. */
  serviceState: string;
  serviceSkipHolidays: boolean;
  /** Von Hand gesetzte Saison-Grenzen (ISO-Datum), gelten nur in ihrem Jahr. */
  serviceSeasonFrom: string | null;
  serviceSeasonTo: string | null;
  taskNotifyTime: string;
  notificationsEnabled: boolean;
  /** Neue Protokolle und Aufgaben sind gleich für alle Betreuer sichtbar (sonst zunächst privat). */
  defaultShared: boolean;
  /** Adresse des JF-Hub-Servers für Protokolle (nur App; im Web-Client ist es der eigene Ursprung). */
  protocolServerUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  serviceReminderEnabled: true,
  serviceWeekday: 1,
  serviceTimeSeason: '17:30',
  serviceTimeOffSeason: '18:00',
  serviceReminderLead: 5,
  serviceState: 'NI',
  serviceSkipHolidays: false,
  serviceSeasonFrom: null,
  serviceSeasonTo: null,
  taskNotifyTime: '08:00',
  notificationsEnabled: true,
  defaultShared: false,
  protocolServerUrl: '',
};

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const row = await db.kv.get(KEY);
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await db.kv.put({ key: KEY, value: next });
  return next;
}
