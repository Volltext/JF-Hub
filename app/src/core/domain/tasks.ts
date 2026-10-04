import type { Priority, Task } from './types';

export type DueState = 'overdue' | 'today' | 'soon' | 'later' | 'none';

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function dueState(dueDate: string | null, today: string): DueState {
  if (!dueDate) return 'none';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  const days = (Date.parse(dueDate) - Date.parse(today)) / 86_400_000;
  return days <= 3 ? 'soon' : 'later';
}

/** Offene Aufgaben: Fälligkeit aufsteigend (ohne Datum zuletzt), dann Priorität. */
export function sortOpen(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

export interface Reminder {
  /** Stabile numerische ID für Android, aus der Aufgaben-ID abgeleitet. */
  id: number;
  title: string;
  body: string;
  at: Date;
}

/** FNV-1a, begrenzt auf positive 31 Bit (Android-Notification-IDs sind Int). */
export function notificationId(taskId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < taskId.length; i++) {
    h ^= taskId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0x7fffffff;
}

/**
 * Erinnerungen für offene Aufgaben mit Fälligkeit: am Fälligkeitstag zur eingestellten Uhrzeit.
 * Zeitpunkte in der Vergangenheit entfallen.
 */
export function planReminders(tasks: Task[], notifyTime: string, now: Date): Reminder[] {
  const [hh, mm] = notifyTime.split(':').map(Number);
  const out: Reminder[] = [];
  for (const t of tasks) {
    if (t.completed || !t.dueDate) continue;
    const [y, m, d] = t.dueDate.split('-').map(Number);
    const at = new Date(y!, m! - 1, d, hh ?? 8, mm ?? 0, 0, 0);
    if (at.getTime() <= now.getTime()) continue;
    out.push({
      id: notificationId(t.id),
      title: 'Aufgabe fällig',
      body: t.title,
      at,
    });
  }
  return out;
}
