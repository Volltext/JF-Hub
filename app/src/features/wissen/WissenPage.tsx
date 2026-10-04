import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/core/db/db';
import { Card, Page, Segmented } from '@/core/ui/components';
import { B_FEHLER_GROUPS, WASSERENTNAHME_LABEL, catalogFor, type Wasserentnahme } from '@/features/wettkampf/rules/bwScoring';
import { COMPETITIONS } from '@/features/wettkampf/rules/modes';
import {
  LSP_DISZIPLINEN,
  LSP_FRAGEN_GEBIETE,
  LSP_FRAGEN_HINWEIS,
} from '@/features/wettkampf/rules/leistungsspange';
import { KNOT_GUIDES, POSITION_GUIDES, RULE_ENTRIES } from './bwKnowledge';
import { LSP_POSITION_GUIDES, LSP_RULE_ENTRIES } from './lspKnowledge';
import { matches, searchKnots, searchPositions, searchRules } from './search';
import type { PositionGuide, RuleEntry } from './types';

type Section = 'regeln' | 'positionen' | 'knoten' | 'fehler' | 'disziplinen' | 'fragen';

const SECTIONS: Record<string, { value: Section; label: string }[]> = {
  bw: [
    { value: 'regeln', label: 'Regeln' },
    { value: 'positionen', label: 'Positionen' },
    { value: 'knoten', label: 'Knoten' },
    { value: 'fehler', label: 'Fehler' },
  ],
  lsp: [
    { value: 'regeln', label: 'Regeln' },
    { value: 'disziplinen', label: 'Übungen' },
    { value: 'positionen', label: 'Positionen' },
    { value: 'fragen', label: 'Fragen' },
  ],
};

export function WissenPage() {
  const pref = useLiveQuery(async () => (await db.kv.get('wettkampf.competition'))?.value as string | undefined, []);
  const [section, setSection] = useState<Section>('regeln');
  const [query, setQuery] = useState('');
  const competition = pref ?? 'bw';
  const sections = SECTIONS[competition] ?? SECTIONS.bw!;
  const current = sections.some((s) => s.value === section) ? section : 'regeln';

  return (
    <Page title="Wissen" sub="Regeln, Positionen und Knoten zum Nachschlagen">
      <Segmented
        value={competition}
        onChange={(id) => void db.kv.put({ key: 'wettkampf.competition', value: id })}
        options={COMPETITIONS.map((c) => ({ value: c.id, label: c.label }))}
      />
      <Segmented<Section> value={current} onChange={setSection} options={sections} />
      <input
        className="search"
        type="search"
        placeholder="Suchen …"
        aria-label="Suchen"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {current === 'regeln' && <Rules list={searchRules(competition === 'lsp' ? LSP_RULE_ENTRIES : RULE_ENTRIES, query)} />}
      {current === 'positionen' && (
        <Positions list={searchPositions(competition === 'lsp' ? LSP_POSITION_GUIDES : POSITION_GUIDES, query)} />
      )}
      {current === 'knoten' && <Knots query={query} />}
      {current === 'fehler' && <Errors query={query} />}
      {current === 'disziplinen' && <Disziplinen query={query} />}
      {current === 'fragen' && <Fragen query={query} />}
      <p className="muted">
        Inoffizielle, zusammengefasste Hilfe ohne Gewähr. Maßgeblich sind die aktuellen Richtlinien und Wertungsbögen der Deutschen Jugendfeuerwehr.
      </p>
    </Page>
  );
}

const Empty = () => (
  <Card>
    <p className="muted">Nichts gefunden.</p>
  </Card>
);

function Rules({ list }: { list: RuleEntry[] }) {
  if (list.length === 0) return <Empty />;
  // Nach Kategorie gruppieren, Reihenfolge der Quelle bleibt erhalten.
  const categories = [...new Set(list.map((r) => r.category))];
  return (
    <div className="stack">
      {categories.map((c) => (
        <div key={c} className="stack">
          <div className="group-label">{c}</div>
          {list
            .filter((r) => r.category === c)
            .map((r) => (
              <details key={r.id} className="acc">
                <summary>{r.title}</summary>
                <p>{r.summary}</p>
                <ul className="muted" style={{ paddingLeft: 20 }}>
                  {r.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </details>
            ))}
        </div>
      ))}
    </div>
  );
}

function Positions({ list }: { list: PositionGuide[] }) {
  if (list.length === 0) return <Empty />;
  const sections = [...new Set(list.map((p) => p.section))];
  return (
    <div className="stack">
      {sections.map((s) => (
        <div key={s} className="stack">
          <div className="group-label">{s}</div>
          {list
            .filter((p) => p.section === s)
            .map((p) => (
              <details key={p.id} className="acc">
                <summary>
                  <span className="pos-badge">{p.shortLabel}</span> {p.title}
                </summary>
                <div className="group-label">Aufgaben</div>
                <ul style={{ paddingLeft: 20 }}>
                  {p.duties.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
                <div className="group-label">Darauf achten</div>
                <ul className="muted" style={{ paddingLeft: 20 }}>
                  {p.watchouts.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            ))}
        </div>
      ))}
    </div>
  );
}

function Knots({ query }: { query: string }) {
  const list = searchKnots(KNOT_GUIDES, query);
  if (list.length === 0) return <Empty />;
  return (
    <div className="stack">
      {list.map((k) => (
        <details key={k.id} className="acc">
          <summary>{k.title}</summary>
          <ol style={{ paddingLeft: 20 }}>
            {k.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </details>
      ))}
    </div>
  );
}

/** Der Fehlerkatalog kommt direkt aus den Wertungsdaten – eine Quelle für Stoppuhr und Nachschlagen. */
function Errors({ query }: { query: string }) {
  const pref = useLiveQuery(async () => (await db.kv.get('wettkampf.wasserentnahme'))?.value as Wasserentnahme | undefined, []);
  const variant: Wasserentnahme = pref ?? 'saug';
  const sets = [
    { title: `A-Teil (${WASSERENTNAHME_LABEL[variant]})`, groups: catalogFor('a', variant) },
    { title: 'B-Teil (Staffellauf)', groups: B_FEHLER_GROUPS },
  ];
  const shown = sets
    .map((s) => ({
      ...s,
      groups: s.groups
        .map((g) => ({ ...g, errors: g.errors.filter((e) => matches(query, e.label, g.title, s.title)) }))
        .filter((g) => g.errors.length > 0),
    }))
    .filter((s) => s.groups.length > 0);
  return (
    <div className="stack">
      {shown.length === 0 && <Empty />}
      {shown.map((s) => (
        <div key={s.title} className="stack">
          <div className="group-label">{s.title}</div>
          {s.groups.map((g) => (
            <details key={g.id} className="acc" open={query.trim().length > 0}>
              <summary>{g.title}</summary>
              <div className="list">
                {g.errors.map((e) => (
                  <div key={e.id} className="stepper-row">
                    <div className="item__main">
                      {e.label}
                      {e.unverified && <div className="item__sub" style={{ color: 'var(--warning)' }}>Punkte ungeprüft</div>}
                    </div>
                    <span className="chip chip--warn">
                      {e.points}
                      {e.perCase ? ' / Fall' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      ))}
      <p className="muted">Fehlerpunkte nach DJF-Wertungsbögen (Stand 07.09.2013).</p>
    </div>
  );
}

function Disziplinen({ query }: { query: string }) {
  const list = LSP_DISZIPLINEN.filter((d) => matches(query, d.label, d.kurz, d.hinweise, d.nullwertungen.map((n) => n.label)));
  if (list.length === 0) return <Empty />;
  return (
    <div className="stack">
      {list.map((d) => (
        <details key={d.id} className="acc">
          <summary>{d.label}</summary>
          <p>{d.kurz}</p>
          <div className="group-label">Hinweise</div>
          <ul className="muted" style={{ paddingLeft: 20 }}>
            {d.hinweise.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <div className="group-label">Nullwertung bei</div>
          <ul style={{ paddingLeft: 20 }}>
            {d.nullwertungen.map((n) => (
              <li key={n.id}>{n.label}</li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

function Fragen({ query }: { query: string }) {
  const list = LSP_FRAGEN_GEBIETE.filter((g) => matches(query, g.label, g.impulse));
  return (
    <div className="stack">
      <Card>
        <p className="muted">{LSP_FRAGEN_HINWEIS}</p>
      </Card>
      {list.length === 0 && <Empty />}
      {list.map((g) => (
        <details key={g.id} className="acc">
          <summary>{g.label}</summary>
          <ul style={{ paddingLeft: 20 }}>
            {g.impulse.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
