import { useEffect, useRef, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';

export interface SnackAction {
  label: string;
  run: () => void;
}

interface Snack {
  id: number;
  message: string;
  action?: SnackAction;
  duration: number;
}

let current: Snack | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * Kurzer Hinweis unten am Bildschirm, z. B. „Erledigt“ mit „Rückgängig“. Ein neuer Hinweis ersetzt den alten.
 * Er verschwindet nach `duration` ms von selbst, aber nicht, solange Maus oder Fokus auf ihm liegen.
 */
export function showSnack(message: string, opts: { action?: SnackAction; duration?: number } = {}): void {
  current = { id: ++seq, message, action: opts.action, duration: opts.duration ?? (opts.action ? 6000 : 4000) };
  emit();
}

export function hideSnack(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

/** Einmal im App-Gerüst einbinden. Der Bereich ist immer da, damit Screenreader neue Hinweise ansagen. */
export function SnackbarHost() {
  const snack = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => current,
  );
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const held = useRef(false);

  const arm = (ms: number) => {
    clearTimeout(timer.current);
    if (!snack) return;
    const id = snack.id;
    timer.current = setTimeout(() => !held.current && hideSnack(id), ms);
  };

  useEffect(() => {
    held.current = false;
    arm(snack?.duration ?? 0);
    // Der runde Plus-Knopf rückt nach oben, solange ein Hinweis steht.
    document.body.classList.toggle('has-snack', !!snack);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snack]);

  const hold = () => {
    held.current = true;
    clearTimeout(timer.current);
  };
  const release = () => {
    held.current = false;
    arm(3000);
  };

  return (
    <div className="snack-region" role="status" aria-live="polite">
      {snack && (
        <div key={snack.id} className="snack" onMouseEnter={hold} onMouseLeave={release} onFocus={hold} onBlur={release}>
          <span className="snack__text">{snack.message}</span>
          {snack.action && (
            <button
              type="button"
              className="snack__action"
              onClick={() => {
                snack.action!.run();
                hideSnack(snack.id);
              }}
            >
              {snack.action.label}
            </button>
          )}
          <button type="button" className="snack__close" aria-label="Hinweis schließen" onClick={() => hideSnack(snack.id)}>
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
