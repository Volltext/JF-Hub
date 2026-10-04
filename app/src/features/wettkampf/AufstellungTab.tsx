import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/core/db/db';
import { Button, Card, Segmented, Sheet } from '@/core/ui/components';
import { applyMapping, assign, clearSection } from './lineup';
import type { LspState } from './model';
import {
  A_PART_POSITIONS,
  B_PART_POSITIONS,
  LSP_GRUPPE_POSITIONS,
  LSP_GRUPPE_VON_A_TEIL,
  LSP_STAFFEL_POSITIONS,
  LSP_STAFFEL_VON_A_TEIL,
  type Position,
} from './rules/positions';
import { loadLineup, saveLineup, saveLsp, templateRepo } from './store';
import { confirmDialog } from '@/core/ui/dialog';

interface Section {
  id: string;
  label: string;
  positions: Position[];
  /** Zielposition → A-Teil-Position, falls aus dem A-Teil übernehmbar. */
  fromA?: Record<string, string>;
}

const BW_SECTIONS: Section[] = [
  { id: 'a', label: 'A-Teil', positions: A_PART_POSITIONS },
  { id: 'b', label: 'B-Teil', positions: B_PART_POSITIONS },
];
const LSP_SECTIONS: Section[] = [
  { id: 'gruppe', label: 'Gruppe', positions: LSP_GRUPPE_POSITIONS, fromA: LSP_GRUPPE_VON_A_TEIL },
  { id: 'staffel', label: 'Staffel', positions: LSP_STAFFEL_POSITIONS, fromA: LSP_STAFFEL_VON_A_TEIL },
];

export function AufstellungTab({ competition, lsp }: { competition: string; lsp: LspState }) {
  const members = useLiveQuery(() => db.members.orderBy('name').toArray(), []);
  const lineup = useLiveQuery(loadLineup, []);
  const templates = useLiveQuery(async () => (await db.lineupTemplates.toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), []);
  const [bwSection, setBwSection] = useState('a');
  const [picking, setPicking] = useState<Position | null>(null);
  const [savingName, setSavingName] = useState<string | null>(null);

  if (!members || !lineup || !templates) return null;

  const isLsp = competition === 'lsp';
  const sections = isLsp ? LSP_SECTIONS : BW_SECTIONS;
  const sectionId = isLsp ? lsp.variante : bwSection;
  const section = sections.find((s) => s.id === sectionId) ?? sections[0]!;
  // Aufgestellt werden nur Jugendliche; Betreuer erscheinen nicht in der Auswahl.
  const active = members.filter((m) => m.active && m.kind === 'jugendlich');
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const filled = section.positions.filter((p) => lineup[p.id]).length;

  const change = (next: typeof lineup) => void saveLineup(next);

  if (active.length === 0)
    return (
      <Card>
        <p className="muted">Zum Aufstellen brauchst du aktive Jugendliche unter den Mitgliedern.</p>
        <p style={{ marginTop: 'var(--s-3)' }}>
          <Link to="/mitglieder">Mitglieder anlegen</Link>
        </p>
      </Card>
    );

  return (
    <>
      <Segmented
        compact
        value={section.id}
        onChange={(id) => (isLsp ? void saveLsp({ ...lsp, variante: id }) : setBwSection(id))}
        options={sections.map((s) => ({ value: s.id, label: s.label }))}
      />

      <div className="list">
        {section.positions.map((p) => {
          const memberId = lineup[p.id];
          const name = memberId ? nameOf.get(memberId) : null;
          return (
            <button key={p.id} className="item" onClick={() => setPicking(p)}>
              <span className="pos-badge">{p.shortLabel}</span>
              <div className="item__main">
                <div className="item__title">{name ?? <span className="muted">frei</span>}</div>
                <div className="item__sub">{p.label}</div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="muted">
        {filled} von {section.positions.length} besetzt
      </p>

      <Card title="Werkzeuge">
        <div className="stack">
          {section.fromA && (
            <Button onClick={() => change(applyMapping(lineup, section.fromA!))}>Aus A-Teil übernehmen</Button>
          )}
          <Button onClick={() => setSavingName('')}>Als Vorlage speichern</Button>
          <Button
            variant="danger"
            disabled={filled === 0}
            onClick={async () => (await confirmDialog(`${section.label} leeren?`, { danger: true, confirmLabel: 'Leeren' })) && change(clearSection(lineup, section.positions))}
          >
            Abschnitt leeren
          </Button>
        </div>
      </Card>

      {templates.length > 0 && (
        <Card title="Vorlagen">
          <div className="list">
            {templates.map((t) => (
              <div key={t.id} className="stepper-row">
                <div className="item__main">
                  <div className="item__title">{t.name}</div>
                  <div className="item__sub">{new Date(t.createdAt).toLocaleDateString('de-DE')}</div>
                </div>
                <Button onClick={async () => (await confirmDialog(`Aufstellung durch „${t.name}“ ersetzen?`, { confirmLabel: 'Ersetzen' })) && change({ ...lineup, ...t.assignments })}>
                  Laden
                </Button>
                <button className="stepper-btn" aria-label={`${t.name} löschen`} onClick={async () => (await confirmDialog('Vorlage löschen?', { danger: true, confirmLabel: 'Löschen' })) && templateRepo.remove(t.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {picking && (
        <Sheet title={`Wer macht ${picking.shortLabel}?`} onClose={() => setPicking(null)}>
          <p className="muted">{picking.label}</p>
          <div className="list">
            <button
              className="toggle"
              aria-pressed={!lineup[picking.id]}
              onClick={() => {
                change(assign(lineup, section.positions, picking.id, null));
                setPicking(null);
              }}
            >
              <span className="toggle__box" />
              Frei lassen
            </button>
            {active.map((m) => {
              const here = section.positions.find((p) => lineup[p.id] === m.id);
              return (
                <button
                  key={m.id}
                  className="toggle"
                  aria-pressed={lineup[picking.id] === m.id}
                  onClick={() => {
                    change(assign(lineup, section.positions, picking.id, m.id));
                    setPicking(null);
                  }}
                >
                  <span className="toggle__box">{lineup[picking.id] === m.id && '✓'}</span>
                  <span style={{ flex: 1 }}>{m.name}</span>
                  {here && here.id !== picking.id && <span className="chip">{here.shortLabel} · tauscht</span>}
                </button>
              );
            })}
          </div>
        </Sheet>
      )}

      {savingName !== null && (
        <Sheet title="Vorlage speichern" onClose={() => setSavingName(null)}>
          <label className="field">
            <span>Name</span>
            <input autoFocus value={savingName} placeholder="z. B. Wettkampf-Aufstellung" onChange={(e) => setSavingName(e.target.value)} />
          </label>
          <Button
            variant="primary"
            onClick={async () => {
              await templateRepo.add(savingName, lineup);
              setSavingName(null);
            }}
          >
            Speichern
          </Button>
        </Sheet>
      )}
    </>
  );
}
