import { formatTime } from './calendar';

/** Aktuelle Uhrzeit als „HH:MM“. */
export function nowTime(date = new Date()): string {
  return formatTime(date.getHours(), date.getMinutes());
}

/** Liest eine getippte Uhrzeit: „1730“, „17:30“, „930“, „9“ oder „9.30“; ungültig → null. */
export function parseTypedTime(text: string): { h: number; min: number } | null {
  const s = text.trim().replace(/[.,]/g, ':');
  let h: number;
  let min: number;
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (colon) {
    h = Number(colon[1]);
    min = colon[2]!.length === 1 ? Number(colon[2]) * 10 : Number(colon[2]);
  } else if (/^\d{1,4}$/.test(s)) {
    if (s.length <= 2) (h = Number(s), (min = 0));
    else (h = Number(s.slice(0, s.length - 2)), (min = Number(s.slice(-2))));
  } else return null;
  return h < 24 && min < 60 ? { h, min } : null;
}
