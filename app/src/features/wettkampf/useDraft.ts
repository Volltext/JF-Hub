import { useCallback, useEffect, useRef, useState } from 'react';
import { keepScreenOn } from '@/core/native/device';
import type { Draft } from './model';
import { loadDraft, saveDraft } from './store';

/** Liefert den Entwurf nur, wenn er zum gewünschten Modus gehört (beim Moduswechsel steht kurz noch der alte im State). */
export function draftForMode(draft: Draft | null, mode: string): Draft | null {
  return draft && draft.mode === mode ? draft : null;
}

/**
 * Stoppuhr-Zustand eines Modus: wird geladen, bei jeder Änderung gespeichert (auch laufend,
 * dadurch übersteht er einen App-Neustart) und tickt alle 50 ms, solange die Uhr läuft.
 */
export function useDraft(mode: string) {
  const [loaded, setLoaded] = useState<Draft | null>(null);
  const [, setTick] = useState(0);
  const ref = useRef<Draft | null>(null);

  useEffect(() => {
    let alive = true;
    ref.current = null;
    setLoaded(null);
    void loadDraft(mode).then((d) => {
      if (!alive) return;
      ref.current = d;
      setLoaded(d);
    });
    return () => {
      alive = false;
    };
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

  /** Wendet eine Änderung an; mit `now` für zeitabhängige Übergänge. */
  const update = useCallback(
    (fn: (d: Draft, now: number) => Draft) => {
      const cur = ref.current;
      if (!cur || cur.mode !== mode) return;
      const next = fn(cur, Date.now());
      if (next === cur) return;
      ref.current = next;
      setLoaded(next);
      void saveDraft(next);
    },
    [mode],
  );

  return { draft, update };
}
