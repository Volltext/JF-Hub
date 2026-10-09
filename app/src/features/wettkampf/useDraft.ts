import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { keepScreenOn } from '@/core/native/device';
import type { Draft } from './model';
import type { DraftOp } from './ops';
import { live } from './live';

/** Liefert den Entwurf nur, wenn er zum gewünschten Modus gehört (beim Moduswechsel steht kurz noch der alte im State). */
export function draftForMode(draft: Draft | null, mode: string): Draft | null {
  return draft && draft.mode === mode ? draft : null;
}

/**
 * Stoppuhr-Zustand eines Modus aus der Live-Stoppuhr (`live.ts`): wird geladen, bei jeder Änderung gespeichert
 * (auch laufend, dadurch übersteht er einen App-Neustart), mit den anderen Betreuern abgeglichen und tickt alle 50 ms,
 * solange die Uhr läuft – auch auf Geräten, die nur zuschauen.
 */
export function useDraft(mode: string) {
  const [, setTick] = useState(0);
  const subscribe = useCallback((fn: () => void) => live.subscribe(mode, fn), [mode]);
  const loaded = useSyncExternalStore(subscribe, () => live.peek(mode));

  useEffect(() => {
    void live.load(mode);
  }, [mode]);

  // Nie einen Entwurf eines anderen Modus ausliefern – sonst rechnen Wertung und Anzeige mit falschen Daten.
  const draft = draftForMode(loaded, mode);
  const running = draft?.isRunning ?? false;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 50);
    void keepScreenOn(true);
    return () => {
      clearInterval(t);
      void keepScreenOn(false);
    };
  }, [running]);

  /** Wendet eine Eingabe an; mit `session` nur, solange noch dieser Lauf angezeigt wird. */
  const dispatch = useCallback((op: DraftOp, session?: string) => live.dispatch(mode, op, session), [mode]);

  return { draft, dispatch, editor: live.editor(mode) };
}
