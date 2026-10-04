const pad = (n: number) => String(n).padStart(2, '0');

export const toIso = (y: number, m: number, d: number): string => `${y}-${pad(m + 1)}-${pad(d)}`;

export function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const check = new Date(y, m, d);
  return check.getFullYear() === y && check.getMonth() === m && check.getDate() === d ? { y, m, d } : null;
}

/**
 * Monatsraster für den Kalender: Wochen beginnen am Montag, Lücken vor dem 1. und nach dem Letzten sind null.
 * `m` ist 0-basiert (wie bei Date).
 */
export function monthGrid(y: number, m: number): (string | null)[][] {
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => toIso(y, m, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** Verschiebt (Jahr, Monat) um `delta` Monate; der Monat bleibt in 0–11. */
export function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const total = y * 12 + m + delta;
  return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
}

export const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** „HH:MM“ → Stunde und Minute; ungültige Werte ergeben 0:00. */
export function parseTime(value: string): { h: number; min: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  const h = match ? Number(match[1]) : 0;
  const min = match ? Number(match[2]) : 0;
  return h < 24 && min < 60 ? { h, min } : { h: 0, min: 0 };
}

export const formatTime = (h: number, min: number): string => `${pad(h)}:${pad(min)}`;
