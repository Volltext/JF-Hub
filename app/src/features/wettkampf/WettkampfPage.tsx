import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Settings } from 'lucide-react';
import { Segmented } from '@/core/ui/components';
import { db } from '@/core/db/db';
import { AnalyseTab } from './AnalyseTab';
import { AufstellungTab } from './AufstellungTab';
import { StoppuhrTab } from './StoppuhrTab';
import { WASSERENTNAHME_LABEL } from './rules/bwScoring';
import { COMPETITIONS, getCompetition, getMode } from './rules/modes';
import { loadLsp, loadWasserentnahme } from './store';

type Tab = 'aufstellung' | 'stoppuhr' | 'analyse';

const COMPETITION_KEY = 'wettkampf.competition';
const LAST_MODE = (competition: string) => `wettkampf.mode.${competition}`;

/** Wettkampf-Bereich: Aufstellung, Stoppuhr und Analyse für Bundeswettbewerb und Leistungsspange. */
export function WettkampfPage() {
  const [tab, setTab] = useState<Tab>('stoppuhr');
  const prefs = useLiveQuery(async () => ({
    competition: ((await db.kv.get(COMPETITION_KEY))?.value as string | undefined) ?? 'bw',
    variant: await loadWasserentnahme(),
    modes: Object.fromEntries((await db.kv.where('key').startsWith('wettkampf.mode.').toArray()).map((r) => [r.key, r.value as string])),
  }), []);
  const lsp = useLiveQuery(loadLsp, []);
  if (!prefs || !lsp) return null;

  const competition = getCompetition(prefs.competition);
  const mode = prefs.modes[LAST_MODE(competition.id)] ?? competition.modes[0]!;
  const variantLabel = `Wasserentnahme: ${WASSERENTNAHME_LABEL[prefs.variant]} – in den Einstellungen ändern`;

  return (
    <div className="page page--tight">
      {/* Kopfzeile bewusst flach: Wettbewerb und Bereich auf möglichst wenig Höhe. */}
      <div className="head-compact">
        <div className="row" style={{ gap: 'var(--s-2)' }}>
          <div style={{ flex: 1 }}>
            <Segmented
              compact
              value={competition.id}
              onChange={(id) => void db.kv.put({ key: COMPETITION_KEY, value: id })}
              options={COMPETITIONS.map((c) => ({ value: c.id, label: c.label }))}
            />
          </div>
          {competition.id === 'bw' && (
            <Link to="/einstellungen/wettkampf" className="icon-btn" aria-label={variantLabel} title={variantLabel}>
              <Settings size={18} />
            </Link>
          )}
        </div>

        <Segmented<Tab>
          compact
          value={tab}
          onChange={setTab}
          options={[
            { value: 'aufstellung', label: 'Aufstellung' },
            { value: 'stoppuhr', label: 'Stoppuhr' },
            { value: 'analyse', label: 'Analyse' },
          ]}
        />
      </div>

      {tab === 'aufstellung' && <AufstellungTab competition={competition.id} lsp={lsp} />}
      {tab === 'stoppuhr' && (
        <StoppuhrTab
          competition={competition.id}
          mode={mode}
          lsp={lsp}
          defaultVariant={prefs.variant}
          onMode={(id) => void db.kv.put({ key: LAST_MODE(competition.id), value: id })}
          onShow={(id) => {
            const target = getMode(id).competition;
            void db.kv.bulkPut([
              { key: COMPETITION_KEY, value: target },
              { key: LAST_MODE(target), value: id },
            ]);
          }}
        />
      )}
      {tab === 'analyse' && <AnalyseTab competition={competition.id} lsp={lsp} />}
    </div>
  );
}
