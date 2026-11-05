import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/core/db/db';
import { shareTextFile } from '@/core/native/files';
import { Button, Card, Segmented } from '@/core/ui/components';
import { runsToCsv } from './csv';
import { positionMatrix } from './lineup';
import type { LspState, Run } from './model';
import {
  LSP_DISZIPLINEN,
  LSP_GESAMTEINDRUCK_SKALA,
  LSP_MINDESTPUNKTE,
  computeLspGesamt,
} from './rules/leistungsspange';
import { getCompetitionForMode, getMode } from './rules/modes';
import { MiniLine } from '@/core/ui/charts';
import { A_PART_POSITIONS, B_PART_POSITIONS, LSP_GRUPPE_POSITIONS, LSP_STAFFEL_POSITIONS } from './rules/positions';
import { runTitle } from './run';
import { runRepo, saveLsp } from './store';
import { formatClock } from './stopwatch';
import { confirmDialog } from '@/core/ui/dialog';

type View = 'verlauf' | 'matrix' | 'bogen';

export function AnalyseTab({ competition, lsp }: { competition: string; lsp: LspState }) {
  const allRuns = useLiveQuery(() => db.runs.orderBy('createdAt').reverse().toArray(), []);
  const [view, setView] = useState<View>('verlauf');
  if (!allRuns) return null;

  const isLsp = competition === 'lsp';
  const runs = allRuns.filter((r) => getCompetitionForMode(r.mode) === competition);
  const effective: View = view === 'bogen' && !isLsp ? 'verlauf' : view;

  return (
    <>
      <Segmented<View>
        compact
        value={effective}
        onChange={setView}
        options={[
          { value: 'verlauf', label: 'Verlauf' },
          { value: 'matrix', label: 'Matrix' },
          ...(isLsp ? [{ value: 'bogen' as const, label: 'Wertungsbogen' }] : []),
        ]}
      />
      {effective === 'verlauf' && <Verlauf runs={runs} />}
      {effective === 'matrix' && <Matrix runs={runs} competition={competition} lsp={lsp} />}
      {effective === 'bogen' && <Wertungsbogen runs={runs} lsp={lsp} />}
    </>
  );
}

function runSummary(r: Run): string {
  if (r.scoring) return `${r.scoring.total} Pkt`;
  if (r.lsp) return r.lsp.nullwertung ? 'Nullwertung' : r.lsp.punkte === null ? '–' : `${r.lsp.punkte} Pkt`;
  return '';
}

function Verlauf({ runs: all }: { runs: Run[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const modes = [...new Set(all.map((r) => r.mode))];
  const [picked, setPicked] = useState<string>('');
  const mode = modes.includes(picked) ? picked : (modes[0] ?? '');
  if (all.length === 0)
    return (
      <Card>
        <p className="muted">Noch keine Läufe gespeichert. Auf dem Reiter „Stoppuhr“ einen Lauf messen und speichern.</p>
      </Card>
    );

  const runs = modes.length > 1 ? all.filter((r) => r.mode === mode) : all;
  const timed = runs.filter((r) => r.totalMs > 0).slice(0, 15).reverse();
  const day = (r: Run) => new Date(r.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  const label = mode ? getMode(mode).label : '';

  return (
    <>
      {modes.length > 1 && (
        <div className="chips-row chips-row--compact" role="group" aria-label="Läufe zeigen für">
          {modes.map((m) => (
            <button key={m} type="button" className="chip-btn" aria-pressed={m === mode} onClick={() => setPicked(m)}>
              {getMode(m).label}
            </button>
          ))}
        </div>
      )}
      {timed.length >= 2 && (
        <Card title={`Zeiten · ${label}`}>
          <MiniLine
            summary={`Zeitverlauf ${label} über ${timed.length} Läufe`}
            format={(ms) => formatClock(ms)}
            points={timed.map((r) => ({ label: day(r), value: r.totalMs, title: `${day(r)}: ${formatClock(r.totalMs)}` }))}
          />
          <p className="muted chart__hint">Oben ist schneller.</p>
        </Card>
      )}
      <div className="list">
        {runs.map((r) => (
          <div key={r.id}>
            <button className="item" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
              <div className="item__main">
                <div className="item__title">{runTitle(r)}</div>
                <div className="item__sub">{new Date(r.createdAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</div>
              </div>
              {runSummary(r) && <span className="chip">{runSummary(r)}</span>}
            </button>
            {open === r.id && <RunDetail run={r} />}
          </div>
        ))}
      </div>
      <Button
        onClick={() => shareTextFile(`jf-hub-laeufe-${new Date().toISOString().slice(0, 10)}.csv`, runsToCsv(all), 'text/csv')}
      >
        Alle Läufe als CSV exportieren
      </Button>
    </>
  );
}

function RunDetail({ run }: { run: Run }) {
  const [notes, setNotes] = useState(run.notes);
  const lineup = Object.entries(run.lineupSnapshot.assignments).filter(([, m]) => m);
  return (
    <div className="card" style={{ marginTop: 'var(--s-2)' }}>
      <div className="stack">
        {run.scoring && (
          <div>
            <strong>{run.scoring.total} Punkte</strong>{' '}
            <span className="muted">
              ({run.scoring.vorgabe} − {run.scoring.fehlerpunkte} Fehler
              {run.scoring.targetSeconds !== null && `, Soll ${run.scoring.targetSeconds} s`})
            </span>
            {run.scoring.fehler.length > 0 && (
              <ul className="muted" style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {run.scoring.fehler.map((f) => (
                  <li key={f.id}>
                    {f.count}× {f.label} ({f.total})
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {run.lsp && run.lsp.gruende.length > 0 && <div style={{ color: 'var(--warning)' }}>Nullwertung: {run.lsp.gruende.join(', ')}</div>}
        {run.knotDurationMs !== null && <div>Knotenzeit: {formatClock(run.knotDurationMs)}</div>}
        {run.markers.length > 0 && (
          <div className="muted">{[...run.markers].reverse().map((m) => `${m.label} ${formatClock(m.elapsedMs)}`).join(' · ')}</div>
        )}
        {Object.entries(run.taskTimers).some(([, t]) => t.endElapsedMs !== null) && (
          <div className="muted">
            {Object.entries(run.taskTimers)
              .filter(([, t]) => t.endElapsedMs !== null)
              .map(([l, t]) => `${l} ${formatClock(t.endElapsedMs! - t.startElapsedMs)}`)
              .join(' · ')}
          </div>
        )}
        {lineup.length > 0 && (
          <div className="muted">{lineup.map(([, m]) => run.lineupSnapshot.memberNames[m!] ?? '?').join(', ')}</div>
        )}
        <label className="field">
          <span>Notizen</span>
          <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== run.notes && runRepo.updateNotes(run.id, notes)} />
        </label>
        <Button variant="danger" onClick={async () => (await confirmDialog('Diesen Lauf löschen?', { danger: true, confirmLabel: 'Löschen' })) && runRepo.remove(run.id)}>
          Lauf löschen
        </Button>
      </div>
    </div>
  );
}

function Matrix({ runs, competition, lsp }: { runs: Run[]; competition: string; lsp: LspState }) {
  const positions =
    competition === 'lsp'
      ? lsp.variante === 'staffel'
        ? LSP_STAFFEL_POSITIONS
        : LSP_GRUPPE_POSITIONS
      : [...A_PART_POSITIONS, ...B_PART_POSITIONS];
  const rows = positionMatrix(runs, new Set(positions.map((p) => p.id)));
  if (rows.length === 0)
    return (
      <Card>
        <p className="muted">Die Matrix zeigt, wer wie oft welche Position hatte – sie füllt sich mit gespeicherten Läufen.</p>
      </Card>
    );
  return (
    <div className="list">
      {rows.map((row) => (
        <div key={row.memberId} className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{row.name}</strong>
            <span className="muted">{row.runs} Läufe</span>
          </div>
          <div className="chips-row" style={{ marginTop: 'var(--s-2)' }}>
            {row.counts.map((c) => (
              <span key={c.position.id} className="chip" style={{ opacity: 0.5 + 0.5 * (c.count / row.counts[0]!.count) }}>
                {c.position.shortLabel} × {c.count}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Wertungsbogen({ runs, lsp }: { runs: Run[]; lsp: LspState }) {
  // Je Disziplin der jüngste Lauf in der gewählten Wettbewerbsform.
  const latest = (id: string) => runs.find((r) => r.mode === id && r.lsp?.variante === lsp.variante) ?? null;
  const punkte = Object.fromEntries(LSP_DISZIPLINEN.map((d) => [d.id, latest(d.id)?.lsp?.punkte ?? null]));
  const g = computeLspGesamt(punkte, lsp.gesamteindruck);

  return (
    <div className="stack">
      <Card title={`Wertungsbogen · ${lsp.variante === 'staffel' ? 'Staffel' : 'Gruppe'}`}>
        <div className="list">
          {LSP_DISZIPLINEN.map((d) => (
            <div key={d.id} className="stepper-row">
              <div className="item__main">{d.label}</div>
              <strong>{punkte[d.id] ?? '–'}</strong>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Gesamteindruck der fünf Wertungsrichter">
        <div className="stack">
          {lsp.gesamteindruck.map((val, i) => (
            <div key={i} className="field">
              <span className="muted">Wertungsrichter {i + 1}</span>
              <div className="scale">
                {LSP_GESAMTEINDRUCK_SKALA.map((s) => (
                  <button
                    key={s.punkte}
                    aria-pressed={val === s.punkte}
                    onClick={() =>
                      void saveLsp({ ...lsp, gesamteindruck: lsp.gesamteindruck.map((x, j) => (j === i ? (x === s.punkte ? null : s.punkte) : x)) })
                    }
                  >
                    <strong>{s.punkte}</strong>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Gesamt">
        <div className="score">
          <div className="score__total">{g.summe.toString().replace('.', ',')}</div>
          <div className="muted">
            Übungen {g.uebungsSumme}
            {g.gesamteindruckDurchschnitt !== null && ` + Gesamteindruck Ø ${g.gesamteindruckDurchschnitt.toString().replace('.', ',')}`} · mindestens {LSP_MINDESTPUNKTE}
          </div>
        </div>
        {g.bestanden && <p style={{ color: 'var(--success)', marginTop: 'var(--s-3)' }}>Bestanden</p>}
        {g.wiederholungMoeglich && (
          <p style={{ color: 'var(--warning)', marginTop: 'var(--s-3)' }}>Eine 0-Wertung darf einmal wiederholt werden.</p>
        )}
        {g.ausgeschieden && (
          <ul style={{ color: 'var(--danger)', margin: 'var(--s-3) 0 0', paddingLeft: 20 }}>
            {g.ausscheidegruende.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
        {!g.vollstaendig && !g.ausgeschieden && <p className="muted" style={{ marginTop: 'var(--s-3)' }}>Noch nicht vollständig bewertet.</p>}
      </Card>
    </div>
  );
}
