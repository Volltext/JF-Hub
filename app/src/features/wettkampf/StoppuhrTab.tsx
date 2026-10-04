import { useEffect, useState } from 'react';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { Button, Card } from '@/core/ui/components';
import { tap } from '@/core/native/device';
import { BwPanel } from './BwPanel';
import { LspPanel } from './LspPanel';
import { canSave } from './run';
import type { LspState } from './model';
import type { Wasserentnahme } from './rules/bwScoring';
import { getMode, getModesForCompetition, markersFor } from './rules/modes';
import { runRepo, saveLsp } from './store';
import {
  KNOT_START,
  addSplit,
  elapsedOf,
  formatClock,
  hasData,
  removeMarker,
  reset,
  resetTaskTimer,
  start,
  stop,
} from './stopwatch';
import { useDraft } from './useDraft';
import { confirmDialog } from '@/core/ui/dialog';

interface Props {
  competition: string;
  mode: string;
  onMode: (id: string) => void;
  lsp: LspState;
  /** Zuletzt gewählte Wasserentnahme; gilt für neue A-Teil-Läufe. */
  defaultVariant: Wasserentnahme;
}

export function StoppuhrTab({ competition, mode, onMode, lsp, defaultVariant }: Props) {
  const { draft, update } = useDraft(mode);
  const [toast, setToast] = useState('');
  const info = getMode(mode);
  const isLsp = info.competition === 'lsp';
  const variant: Wasserentnahme = draft?.wasserentnahme ?? defaultVariant;
  const markers = markersFor(mode, variant);

  // Ein A-Teil-Entwurf ohne erfasste Daten folgt der Einstellung; mit Daten behält er seine Variante.
  useEffect(() => {
    if (draft && mode === 'a' && draft.wasserentnahme !== defaultVariant && !hasData(draft, Date.now()))
      update((d) => ({ ...d, wasserentnahme: defaultVariant }));
  }, [draft, mode, defaultVariant, update]);

  const modeChips = (
    <div className="chips-row chips-row--compact" role="group" aria-label="Modus">
      {getModesForCompetition(competition).map((m) => (
        <button key={m.id} className="chip-btn" aria-pressed={m.id === mode} onClick={() => onMode(m.id)}>
          {m.shortLabel}
        </button>
      ))}
    </div>
  );

  if (!draft) return modeChips;

  const now = Date.now();
  const elapsed = elapsedOf(draft, now);
  const showClock = info.kind === 'timed';

  async function save() {
    if (!draft) return;
    await runRepo.saveFromDraft(draft, lsp.variante);
    // Der gespeicherte Lauf setzt den Entwurf zurück; State aus dem Speicher neu laden.
    update((d) => reset(d));
    setToast('Lauf gespeichert ✓');
    setTimeout(() => setToast(''), 2000);
  }

  return (
    <>
      {modeChips}

      {showClock && (
        <Card>
          <div className="clock" aria-live="off">
            {formatClock(elapsed)}
          </div>
          <div className="row" style={{ gap: 'var(--s-3)' }}>
            {draft.isRunning ? (
              <Button
                variant="danger"
                className="clock__main"
                onClick={() => {
                  void tap('heavy');
                  update((d, n) => stop(d, n));
                }}
              >
                <Pause size={22} style={{ verticalAlign: -4 }} /> Stopp
              </Button>
            ) : (
              <Button
                variant="primary"
                className="clock__main"
                onClick={() => {
                  void tap('heavy');
                  update((d, n) => start(d, n));
                }}
              >
                <Play size={22} style={{ verticalAlign: -4 }} /> {elapsed > 0 ? 'Weiter' : 'Start'}
              </Button>
            )}
            <Button
              aria-label="Zurücksetzen"
              disabled={!hasData(draft, now)}
              onClick={async () => {
                if (!hasData(draft, now) || (await confirmDialog('Stoppuhr und erfasste Daten zurücksetzen?', { danger: true, confirmLabel: 'Zurücksetzen' })))
                  update((d) => reset(d));
              }}
            >
              <RotateCcw size={20} />
            </Button>
          </div>

          {/* A-Teil: Zwischenzeiten, B-Teil: Aufgaben-Timer */}
          {markers.length > 0 && (
            <div className="grid2" style={{ marginTop: 'var(--s-3)' }}>
              {markers.map((label) => {
                const task = draft.taskTimers[label];
                const isTask = info.markersAreTasks;
                const done = isTask ? task?.endElapsedMs != null : label === KNOT_START && draft.knotStartElapsedMs !== null;
                const active = isTask && task && task.endElapsedMs === null;
                return (
                  <button
                    key={label}
                    className="marker-btn"
                    aria-pressed={!!active}
                    disabled={!draft.isRunning || done}
                    onClick={() => {
                      void tap('medium');
                      update((d, n) => addSplit(d, label, n));
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (isTask) update((d) => resetTaskTimer(d, label));
                    }}
                  >
                    <strong>{label}</strong>
                    <small>
                      {isTask && task
                        ? task.endElapsedMs !== null
                          ? formatClock(task.endElapsedMs - task.startElapsedMs)
                          : 'läuft … (tippen zum Stoppen)'
                        : done
                          ? 'gesetzt'
                          : ' '}
                    </small>
                  </button>
                );
              })}
            </div>
          )}

          {info.markersAreTasks && Object.keys(draft.taskTimers).length > 0 && (
            <div className="list" style={{ marginTop: 'var(--s-3)' }}>
              {Object.entries(draft.taskTimers).map(([label, t]) => (
                <div key={label} className="stepper-row">
                  <div className="item__main">{label}</div>
                  <span className="muted">{t.endElapsedMs !== null ? formatClock(t.endElapsedMs - t.startElapsedMs) : 'läuft'}</span>
                  <button className="stepper-btn" aria-label={`${label} zurücksetzen`} onClick={() => update((d) => resetTaskTimer(d, label))}>
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {!info.markersAreTasks && draft.markers.length > 0 && (
            <div className="list" style={{ marginTop: 'var(--s-3)' }}>
              {draft.markers.map((m) => (
                <div key={m.id} className="stepper-row">
                  <div className="item__main">{m.label}</div>
                  <span className="muted">{formatClock(m.elapsedMs)}</span>
                  <button className="stepper-btn" aria-label={`${m.label} entfernen`} onClick={() => update((d) => removeMarker(d, m.id))}>
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {draft.knotDurationMs !== null && (
            <p style={{ marginTop: 'var(--s-3)' }}>
              Knotenzeit: <strong>{formatClock(draft.knotDurationMs)}</strong>
            </p>
          )}
        </Card>
      )}

      {isLsp ? (
        <LspPanel
          draft={draft}
          update={update}
          variante={lsp.variante}
          onVariante={(variante) => void saveLsp({ ...lsp, variante })}
        />
      ) : (
        <BwPanel draft={draft} update={update} variant={variant} />
      )}

      <Card title="Notizen">
        <textarea
          className="textarea"
          rows={3}
          placeholder="Was lief gut, was nicht?"
          value={draft.notes}
          onChange={(e) => update((d) => ({ ...d, notes: e.target.value }))}
        />
      </Card>

      <Button variant="primary" disabled={!canSave(draft, now)} onClick={save}>
        Lauf speichern
      </Button>
      {draft.isRunning && <p className="muted">Zum Speichern zuerst stoppen.</p>}
      {toast && (
        <p role="status" className="muted">
          {toast}
        </p>
      )}
    </>
  );
}
