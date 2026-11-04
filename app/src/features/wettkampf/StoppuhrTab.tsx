import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { db } from '@/core/db/db';
import { newId } from '@/core/domain/id';
import { Button, Card } from '@/core/ui/components';
import { tap } from '@/core/native/device';
import { BwPanel } from './BwPanel';
import { LspPanel } from './LspPanel';
import { live, useLiveStatus, type LiveStatus } from './live';
import { canSave } from './run';
import type { Draft, LspState } from './model';
import type { Wasserentnahme } from './rules/bwScoring';
import { getMode, getModesForCompetition, isKnownMode, markersFor } from './rules/modes';
import { runRepo, saveLsp } from './store';
import { KNOT_START, elapsedOf, formatClock, hasData } from './stopwatch';
import { useDraft } from './useDraft';
import { confirmDialog } from '@/core/ui/dialog';

interface Props {
  competition: string;
  mode: string;
  onMode: (id: string) => void;
  /** Wechselt zu einem Modus, auch in den anderen Wettbewerb (für „Stoppuhr läuft gerade“). */
  onShow: (id: string) => void;
  lsp: LspState;
  /** Zuletzt gewählte Wasserentnahme; gilt für neue A-Teil-Läufe. */
  defaultVariant: Wasserentnahme;
}

const LIVE_LABEL: Record<LiveStatus, string> = {
  off: '',
  connecting: 'Verbinde …',
  live: 'Live',
  offline: 'Offline',
  auth: 'Neu anmelden',
};

/** Modi, deren Stoppuhr gerade läuft (auf diesem Gerät oder, über die Live-Stoppuhr, bei einem anderen Betreuer). */
function useRunningModes(): string[] {
  return (
    useLiveQuery(
      async () =>
        (await db.kv.where('key').startsWith('draft.').toArray())
          .filter((r) => (r.value as Draft | undefined)?.isRunning === true)
          .map((r) => r.key.slice('draft.'.length))
          .filter(isKnownMode),
      [],
    ) ?? []
  );
}

export function StoppuhrTab({ competition, mode, onMode, onShow, lsp, defaultVariant }: Props) {
  // Solange die Stoppuhr offen ist, bleibt sie mit den anderen Betreuern verbunden.
  useEffect(() => live.start(), []);
  const { draft, dispatch, editor } = useDraft(mode);
  const liveStatus = useLiveStatus((s) => s.status);
  const running = useRunningModes();
  const [toast, setToast] = useState('');
  const info = getMode(mode);
  const isLsp = info.competition === 'lsp';
  const variant: Wasserentnahme = draft?.wasserentnahme ?? defaultVariant;
  const markers = markersFor(mode, variant);

  // Ein A-Teil-Entwurf ohne erfasste Daten folgt der Einstellung; mit Daten behält er seine Variante.
  // Nur beim Öffnen, bei einem neuen Lauf oder geänderter Einstellung – nicht bei jeder Änderung von einem anderen
  // Gerät, sonst schalteten zwei Geräte mit verschiedener Einstellung endlos hin und her.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const draftId = draft?.id;
  useEffect(() => {
    const d = draftRef.current;
    if (d && mode === 'a' && d.wasserentnahme !== defaultVariant && !hasData(d, Date.now()))
      dispatch({ type: 'set', patch: { wasserentnahme: defaultVariant } });
  }, [draftId, mode, defaultVariant, dispatch]);

  const elsewhere = running.filter((m) => m !== mode);
  const modeChips = (
    <>
      <div className="chips-row chips-row--compact" role="group" aria-label="Modus">
        {getModesForCompetition(competition).map((m) => (
          <button key={m.id} className="chip-btn" aria-pressed={m.id === mode} onClick={() => onMode(m.id)}>
            {m.shortLabel}
            {running.includes(m.id) && m.id !== mode && <span className="chip-btn__dot" aria-label="(läuft)" />}
          </button>
        ))}
      </div>
      {elsewhere.map((m) => (
        <button key={m} type="button" className="live-banner" onClick={() => onShow(m)}>
          <span className="chip-btn__dot" aria-hidden="true" />
          Stoppuhr läuft gerade: <strong>{getMode(m).label}</strong> – anzeigen
        </button>
      ))}
    </>
  );

  if (!draft) return modeChips;

  const now = Date.now();
  const elapsed = elapsedOf(draft, now);
  const showClock = info.kind === 'timed';

  async function save() {
    if (!draft) return;
    const saved = draft;
    try {
      await runRepo.saveFromDraft(saved, lsp.variante);
      // Genau diesen Lauf zurücksetzen: hat ein anderer Betreuer inzwischen schon gespeichert und neu gestartet, bleibt dessen Lauf.
      dispatch({ type: 'reset' }, saved.id);
      setToast('Lauf gespeichert ✓');
    } catch (e) {
      setToast(`Lauf konnte nicht gespeichert werden: ${e instanceof Error ? e.message : String(e)}`);
    }
    setTimeout(() => setToast(''), 4000);
  }

  return (
    <>
      {modeChips}

      {showClock && (
        <Card>
          {liveStatus !== 'off' && (
            <div className="live-status">
              <span
                className={`chip ${liveStatus === 'live' ? 'chip--ok' : 'chip--warn'}`}
                title={liveStatus === 'live' ? 'Alle angemeldeten Betreuer sehen diese Stoppuhr live.' : 'Änderungen werden nachgereicht, sobald der Server erreichbar ist.'}
              >
                {liveStatus === 'live' ? '● ' : ''}
                {LIVE_LABEL[liveStatus]}
                {liveStatus === 'offline' && live.pending(mode) > 0 && ' – wird nachgereicht'}
              </span>
              {editor && <span className="muted">zuletzt geändert von {editor}</span>}
            </div>
          )}
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
                  dispatch({ type: 'stop' });
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
                  dispatch({ type: 'start' });
                }}
              >
                <Play size={22} style={{ verticalAlign: -4 }} /> {elapsed > 0 ? 'Weiter' : 'Start'}
              </Button>
            )}
            <Button
              aria-label="Zurücksetzen"
              disabled={!hasData(draft, now)}
              onClick={async () => {
                // An den angezeigten Lauf gebunden: startet während der Rückfrage jemand einen neuen, bleibt der.
                const session = draft.id;
                if (!hasData(draft, now) || (await confirmDialog('Stoppuhr und erfasste Daten zurücksetzen?', { danger: true, confirmLabel: 'Zurücksetzen' })))
                  dispatch({ type: 'reset' }, session);
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
                      dispatch({ type: 'split', label, markerId: newId() });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (isTask) dispatch({ type: 'resetTask', label });
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
                  <button className="stepper-btn" aria-label={`${label} zurücksetzen`} onClick={() => dispatch({ type: 'resetTask', label })}>
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
                  <button className="stepper-btn" aria-label={`${m.label} entfernen`} onClick={() => dispatch({ type: 'removeMarker', markerId: m.id })}>
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
          dispatch={dispatch}
          variante={lsp.variante}
          onVariante={(variante) => void saveLsp({ ...lsp, variante })}
        />
      ) : (
        <BwPanel draft={draft} dispatch={dispatch} variant={variant} />
      )}

      <Card title="Notizen">
        <textarea
          className="textarea"
          rows={3}
          placeholder="Was lief gut, was nicht?"
          value={draft.notes}
          onChange={(e) => dispatch({ type: 'set', patch: { notes: e.target.value } })}
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
