import { useSyncExternalStore } from 'react';
import { useOverlayClose } from './overlay';

interface Request {
  message: string;
  title?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  hideCancel: boolean;
  resolve: (ok: boolean) => void;
}

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Hebt die Bestätigung als riskant hervor (z. B. Löschen). */
  danger?: boolean;
  /** Nur ein OK-Knopf (reiner Hinweis). */
  hideCancel?: boolean;
}

let current: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Bestätigungsdialog im App-Design (statt des Android-Standarddialogs). Liefert true bei Bestätigung. */
export function confirmDialog(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => {
    current = {
      message,
      title: opts.title,
      confirmLabel: opts.confirmLabel ?? 'OK',
      cancelLabel: opts.cancelLabel ?? 'Abbrechen',
      danger: opts.danger ?? false,
      hideCancel: opts.hideCancel ?? false,
      resolve,
    };
    emit();
  });
}

/** Hinweisdialog mit einem OK-Knopf. */
export async function alertDialog(message: string, title?: string): Promise<void> {
  await confirmDialog(message, { title, hideCancel: true });
}

function close(ok: boolean) {
  const req = current;
  current = null;
  emit();
  req?.resolve(ok);
}

/** Einmal im App-Gerüst einbinden. */
export function DialogHost() {
  const req = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => current,
  );
  return req ? <Dialog req={req} /> : null;
}

function Dialog({ req }: { req: Request }) {
  useOverlayClose(() => close(false));
  return (
    <div className="dialog-backdrop" onClick={() => close(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={req.title ?? req.message} onClick={(e) => e.stopPropagation()}>
        {req.title && <h2 className="sheet__title">{req.title}</h2>}
        <p style={{ whiteSpace: 'pre-line' }}>{req.message}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {!req.hideCancel && (
            <button className="btn" onClick={() => close(false)}>
              {req.cancelLabel}
            </button>
          )}
          <button className={`btn ${req.danger ? 'btn--danger-solid' : 'btn--primary'}`} onClick={() => close(true)} autoFocus>
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
