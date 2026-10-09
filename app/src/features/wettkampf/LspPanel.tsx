import { useEffect, useState } from 'react';
import { Card, Segmented } from '@/core/ui/components';
import type { Draft } from './model';
import type { DraftOp } from './ops';
import { ErrorCatalog } from './ErrorCatalog';
import { A_FEHLER_GROUPS, A_QUICK_FEHLER } from './rules/bwScoring';
import {
  LSP_GESAMTEINDRUCK_SKALA,
  LSP_OHNE_HINDERNIS_FEHLER_IDS,
  LSP_VARIANTEN,
  getLspDisziplin,
  getLspVariante,
  naechsteStufe,
} from './rules/leistungsspange';
import { lspWertung } from './run';

interface Props {
  draft: Draft;
  dispatch: (op: DraftOp) => void;
  variante: string;
  onVariante: (id: string) => void;
}

/** Leistungsspange: Disziplin-Hinweise, Messwert bzw. Bewertung, Nullwertungen und live berechnete Punkte. */
const toCm = (meters: string): number | null => {
  const n = Number(meters.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const toMeters = (cm: number | null) => (cm ? String(cm / 100).replace('.', ',') : '');

export function LspPanel({ draft, dispatch, variante, onVariante }: Props) {
  const [meters, setMeters] = useState(toMeters(draft.measuredCm));
  // Messwert von einem anderen Gerät (oder anderem Modus) übernehmen; die eigene Eingabe bleibt, solange sie dasselbe meint.
  useEffect(() => {
    setMeters((m) => (toCm(m) === draft.measuredCm ? m : toMeters(draft.measuredCm)));
  }, [draft.measuredCm]);
  const disziplin = getLspDisziplin(draft.mode);
  const wertung = lspWertung(draft, variante, Date.now());
  // Schutz: gehört der Entwurf nicht zu einer Leistungsspangen-Disziplin, gibt es hier nichts anzuzeigen.
  if (!disziplin || !wertung) return null;
  const v = getLspVariante(variante);

  const next = naechsteStufe(draft.mode, variante, wertung.punkte);
  const hint = next
    ? next.bisSekunden !== undefined
      ? `Für ${next.punkte} Punkte: ${next.bisSekunden} s oder schneller`
      : `Für ${next.punkte} Punkte: ab ${((next.abCm ?? 0) / 100).toFixed(2).replace('.', ',')} m Gesamtweite`
    : null;

  return (
    <>
      <Card title={disziplin.label}>
        <div className="stack">
          <Segmented
            value={variante}
            onChange={onVariante}
            options={LSP_VARIANTEN.map((x) => ({ value: x.id, label: `${x.label} (${x.staerke})` }))}
          />
          <p className="muted">{disziplin.kurz}</p>
          <details className="acc">
            <summary>Ablauf und Hinweise</summary>
            <ul className="muted" style={{ margin: 0, paddingLeft: 20 }}>
              {disziplin.hinweise.map((h) => (
                <li key={h}>{h}</li>
              ))}
              {disziplin.kind === 'measured' && <li>Mindestweite {(v.kugelMindestCm / 100).toFixed(0)} m gesamt.</li>}
            </ul>
          </details>
        </div>
      </Card>

      <Card title="Wertung">
        <div className="stack">
          {disziplin.kind === 'measured' && (
            <label className="field">
              <span>Gesamtweite aller Stöße (m)</span>
              <input
                inputMode="decimal"
                placeholder="z. B. 57,5"
                value={meters}
                onChange={(e) => {
                  setMeters(e.target.value);
                  dispatch({ type: 'set', patch: { measuredCm: toCm(e.target.value) } });
                }}
              />
            </label>
          )}

          {disziplin.kind === 'judged' && (
            <div className="field">
              <span>Bewertung der Einheit (0–4)</span>
              <div className="scale">
                {LSP_GESAMTEINDRUCK_SKALA.map((s) => (
                  <button
                    key={s.punkte}
                    aria-pressed={draft.judgePoints === s.punkte}
                    onClick={() => dispatch({ type: 'set', patch: { judgePoints: draft.judgePoints === s.punkte ? null : s.punkte } })}
                  >
                    <strong>{s.punkte}</strong>
                    <small>{s.label}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="score">
            <div className="score__total">{wertung.punkte ?? '–'}</div>
            <div className="muted">
              {wertung.nullwertung ? 'Nullwertung' : wertung.punkte === null ? 'noch keine Wertung' : 'Punkte (von 4)'}
            </div>
            {hint && !wertung.nullwertung && <div className="muted">{hint}</div>}
          </div>

          <div className="group-label">Nullwertung</div>
          <div className="list">
            {disziplin.nullwertungen.map((n) => (
              <button
                key={n.id}
                className="toggle"
                aria-pressed={draft.nullwertungIds.includes(n.id)}
                onClick={() => dispatch({ type: 'nullwertung', id: n.id, on: !draft.nullwertungIds.includes(n.id) })}
              >
                <span className="toggle__box">{draft.nullwertungIds.includes(n.id) && '✓'}</span>
                {n.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {disziplin.id === 'lsp-loeschangriff' && (
        <Card title="Beobachtungshilfe">
          <p className="muted" style={{ marginBottom: 'var(--s-3)' }}>
            Fehler nach dem A-Teil-Katalog (ohne Hindernisse) – zur Auswertung im Training, sie fließen nicht in die Punkte ein.
          </p>
          <ErrorCatalog
            groups={A_FEHLER_GROUPS}
            quick={A_QUICK_FEHLER}
            hiddenIds={[...LSP_OHNE_HINDERNIS_FEHLER_IDS, 'a-q-wassergraben', 'a-q-hindernis']}
            counts={draft.fehlerCounts}
            onAdd={(id) => dispatch({ type: 'fehler', errorId: id, delta: 1 })}
            onRemove={(id) => dispatch({ type: 'fehler', errorId: id, delta: -1 })}
          />
        </Card>
      )}
    </>
  );
}
