/** Ein Protokoll im Papierkorb des Servers (`GET /api/protocols/trash`). */
export interface TrashItem {
  id: string;
  title: string;
  /** Datum des Protokolls (YYYY-MM-DD). */
  datum: string;
  ort: string;
  /** Zeitpunkt des Löschens (ms). */
  deletedAt: number;
  shared: number;
  ownerId: string;
  /** Anzeigename des Besitzers. */
  owner: string;
}

export interface Trash {
  items: TrashItem[];
  /** So viele Tage bleibt ein gelöschtes Protokoll im Papierkorb. */
  trashDays: number;
}

const DAY = 86_400_000;

/** Tage, die ein gelöschtes Protokoll noch im Papierkorb liegt (mindestens 0). */
export function daysLeft(deletedAt: number, trashDays: number, now = Date.now()): number {
  return Math.max(0, Math.ceil(trashDays - (now - deletedAt) / DAY));
}

/** Datum (Ortszeit) als YYYY-MM-DD. */
export function isoOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const leftLabel = (days: number): string => (days <= 0 ? 'wird bald endgültig gelöscht' : days === 1 ? 'noch 1 Tag' : `noch ${days} Tage`);
