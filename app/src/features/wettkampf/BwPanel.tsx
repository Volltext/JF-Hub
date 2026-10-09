import { useEffect, useState } from 'react';
import { Card } from '@/core/ui/components';
import type { Draft } from './model';
import type { DraftOp } from './ops';
import { ErrorCatalog } from './ErrorCatalog';
import { catalogFor, getScoringConfig, type Wasserentnahme } from './rules/bwScoring';
import { bwScore } from './run';
import { maskTime, parseTargetSeconds } from './stopwatch';

type Dispatch = (op: DraftOp) => void;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Wertung im Bundeswettbewerb: Soll-Zeit, Fehlererfassung und live berechnete Punktzahl. */
export function BwPanel({ draft, dispatch, variant }: { draft: Draft; dispatch: Dispatch; variant: Wasserentnahme }) {
  const [target, setTarget] = useState(draft.targetSeconds ? fmt(draft.targetSeconds) : '');
  // Soll-Zeit von einem anderen Gerät (oder anderem Modus) übernehmen; die eigene Eingabe bleibt, solange sie dasselbe meint.
  useEffect(() => {
    setTarget((t) => (parseTargetSeconds(t) === draft.targetSeconds ? t : draft.targetSeconds ? fmt(draft.targetSeconds) : ''));
  }, [draft.targetSeconds]);
  const cfg = getScoringConfig(draft.mode);
  const score = bwScore(draft, Date.now());
  const isA = draft.mode === 'a';

  return (
    <Card title="Wertung">
      <div className="stack">
        <button
          className="toggle"
          aria-pressed={draft.scoringEnabled}
          onClick={() => dispatch({ type: 'set', patch: { scoringEnabled: !draft.scoringEnabled } })}
        >
          <span className="toggle__box">{draft.scoringEnabled && '✓'}</span> Wettkampf-Wertung mitführen
        </button>

        {draft.scoringEnabled && (
          <>
            <label className="field">
              <span>{isA ? 'Vorgabezeit (mm:ss)' : 'Soll-Zeit (mm:ss)'}</span>
              <input
                inputMode="numeric"
                placeholder="z. B. 1:30"
                value={target}
                onChange={(e) => {
                  const masked = maskTime(e.target.value);
                  setTarget(masked);
                  const seconds = parseTargetSeconds(masked);
                  dispatch({ type: 'set', patch: { targetSeconds: seconds } });
                }}
              />
            </label>

            <div className="score">
              <div className="score__total">{score.total}</div>
              <div className="muted">
                {score.vorgabe} − {score.fehlerpunkte} Fehler
                {score.targetSeconds !== null && ` ${score.timeAdjust >= 0 ? '+' : '−'} ${Math.abs(score.timeAdjust)} Zeit`}
              </div>
            </div>

            <ErrorCatalog
              groups={catalogFor(draft.mode, variant)}
              quick={cfg.quick}
              counts={draft.fehlerCounts}
              onAdd={(id) => dispatch({ type: 'fehler', errorId: id, delta: 1 })}
              onRemove={(id) => dispatch({ type: 'fehler', errorId: id, delta: -1 })}
            />
          </>
        )}
      </div>
    </Card>
  );
}
