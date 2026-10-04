import { useState } from 'react';
import { Card } from '@/core/ui/components';
import type { Draft } from './model';
import { ErrorCatalog } from './ErrorCatalog';
import { catalogFor, getScoringConfig, type Wasserentnahme } from './rules/bwScoring';
import { bwScore } from './run';
import { addFehler, maskTime, parseTargetSeconds, removeFehler } from './stopwatch';

type Update = (fn: (d: Draft, now: number) => Draft) => void;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Wertung im Bundeswettbewerb: Soll-Zeit, Fehlererfassung und live berechnete Punktzahl. */
export function BwPanel({ draft, update, variant }: { draft: Draft; update: Update; variant: Wasserentnahme }) {
  const [target, setTarget] = useState(draft.targetSeconds ? fmt(draft.targetSeconds) : '');
  const cfg = getScoringConfig(draft.mode);
  const score = bwScore(draft, Date.now());
  const isA = draft.mode === 'a';

  return (
    <Card title="Wertung">
      <div className="stack">
        <button
          className="toggle"
          aria-pressed={draft.scoringEnabled}
          onClick={() => update((d) => ({ ...d, scoringEnabled: !d.scoringEnabled }))}
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
                  update((d) => ({ ...d, targetSeconds: seconds }));
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
              onAdd={(id) => update((d) => addFehler(d, id))}
              onRemove={(id) => update((d) => removeFehler(d, id))}
            />
          </>
        )}
      </div>
    </Card>
  );
}
