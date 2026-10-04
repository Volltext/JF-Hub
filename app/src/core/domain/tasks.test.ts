import { describe, expect, it } from 'vitest';
import { dueState, notificationId, planReminders, sortOpen } from './tasks';
import type { Task } from './types';

const task = (over: Partial<Task>): Task => ({
  id: 't',
  title: 'T',
  description: '',
  dueDate: null,
  priority: 'medium',
  completed: false,
  createdAt: '2026-01-01T00:00:00Z',
  completedAt: null,
  sessionId: null,
  ...over,
});

describe('dueState', () => {
  it('klassifiziert Fälligkeiten', () => {
    const today = '2026-10-02';
    expect(dueState(null, today)).toBe('none');
    expect(dueState('2026-10-01', today)).toBe('overdue');
    expect(dueState('2026-10-02', today)).toBe('today');
    expect(dueState('2026-10-05', today)).toBe('soon');
    expect(dueState('2026-10-06', today)).toBe('later');
  });
});

describe('sortOpen', () => {
  it('sortiert nach Datum, ohne Datum zuletzt, dann Priorität', () => {
    const list = sortOpen([
      task({ id: 'a', dueDate: null }),
      task({ id: 'b', dueDate: '2026-10-05', priority: 'low' }),
      task({ id: 'c', dueDate: '2026-10-05', priority: 'high' }),
      task({ id: 'd', dueDate: '2026-10-01' }),
    ]);
    expect(list.map((t) => t.id)).toEqual(['d', 'c', 'b', 'a']);
  });
});

describe('planReminders', () => {
  const now = new Date(2026, 9, 2, 12, 0);
  it('plant nur offene, datierte, künftige Aufgaben', () => {
    const r = planReminders(
      [
        task({ id: 'future', dueDate: '2026-10-03' }),
        task({ id: 'pastToday', dueDate: '2026-10-02' }), // 08:00 ist schon vorbei
        task({ id: 'done', dueDate: '2026-10-03', completed: true }),
        task({ id: 'nodate' }),
      ],
      '08:00',
      now,
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.at).toEqual(new Date(2026, 9, 3, 8, 0));
    expect(r[0]!.id).toBe(notificationId('future'));
  });

  it('liefert stabile positive Int-IDs', () => {
    const id = notificationId('some-uuid');
    expect(id).toBe(notificationId('some-uuid'));
    expect(id).toBeGreaterThanOrEqual(0);
    expect(id).toBeLessThanOrEqual(0x7fffffff);
  });
});
