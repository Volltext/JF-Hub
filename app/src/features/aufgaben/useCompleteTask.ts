import { useCallback, useEffect, useRef, useState } from 'react';
import { taskRepo } from '@/core/db/repos';
import type { Task } from '@/core/domain/types';
import { showSnack } from '@/core/ui/snackbar';

/** So lange bleibt eine gerade erledigte Aufgabe durchgestrichen an ihrem Platz stehen. */
export const LINGER_MS = 4000;

/**
 * Abhaken mit Rückgängig: Die Aufgabe ist sofort erledigt (gespeichert), bleibt aber kurz an ihrem Platz stehen.
 * So rutscht nicht die nächste Aufgabe unter den Finger, und ein zweites Antippen oder „Rückgängig“ holt sie zurück.
 */
export function useCompleteTask() {
  const [lingering, setLingering] = useState<ReadonlyMap<string, Task>>(new Map());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);

  const drop = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setLingering((m) => {
      if (!m.has(id)) return m;
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  }, []);

  const reopen = useCallback(
    async (t: Task) => {
      drop(t.id);
      await taskRepo.setCompleted(t.id, false);
    },
    [drop],
  );

  const complete = useCallback(
    async (t: Task) => {
      setLingering((m) => new Map(m).set(t.id, { ...t, completed: true }));
      clearTimeout(timers.current.get(t.id));
      timers.current.set(t.id, setTimeout(() => drop(t.id), LINGER_MS));
      await taskRepo.setCompleted(t.id, true);
      showSnack(`Erledigt: ${t.title}`, { action: { label: 'Rückgängig', run: () => void reopen(t) } });
    },
    [drop, reopen],
  );

  return { lingering, complete, reopen };
}
