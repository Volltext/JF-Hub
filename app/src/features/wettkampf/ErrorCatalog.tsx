import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { FehlerCounts, FehlerDef, FehlerGroup } from './rules/bwScoring';

interface Props {
  groups: FehlerGroup[];
  quick: FehlerDef[];
  counts: FehlerCounts;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  /** Fehler, die nicht angezeigt werden sollen (z. B. Hindernis-Fehler beim Löschangriff der Leistungsspange). */
  hiddenIds?: string[];
}

function Row({ def, count, onAdd, onRemove }: { def: FehlerDef; count: number; onAdd: () => void; onRemove: () => void }) {
  return (
    <div className="stepper-row">
      <div className="item__main">
        <div>{def.label}</div>
        <div className="item__sub">
          {def.points} Pkt{def.perCase ? ' je Fall' : ''}
          {def.unverified && <span style={{ color: 'var(--warning)' }}> · Punkte ungeprüft</span>}
        </div>
      </div>
      {count > 0 && (
        <button className="stepper-btn" aria-label={`${def.label} weniger`} onClick={onRemove}>
          <Minus size={18} />
        </button>
      )}
      {count > 0 && <span className="stepper-count">{count}</span>}
      <button className="stepper-btn stepper-btn--add" aria-label={`${def.label} erfassen`} onClick={onAdd}>
        <Plus size={18} />
      </button>
    </div>
  );
}

/** Schnellzugriff plus durchsuchbarer Fehlerkatalog, nach Rolle gruppiert. */
export function ErrorCatalog({ groups, quick, counts, onAdd, onRemove, hiddenIds = [] }: Props) {
  const [query, setQuery] = useState('');
  const hidden = new Set(hiddenIds);
  const q = query.trim().toLowerCase();

  const visibleGroups = groups
    .map((g) => ({ ...g, errors: g.errors.filter((e) => !hidden.has(e.id) && (!q || e.label.toLowerCase().includes(q))) }))
    .filter((g) => g.errors.length > 0);

  return (
    <div className="stack">
      <div className="group-label">Häufige Fehler</div>
      <div className="list">
        {quick
          .filter((e) => !hidden.has(e.id))
          .map((e) => (
            <Row key={e.id} def={e} count={counts[e.id] ?? 0} onAdd={() => onAdd(e.id)} onRemove={() => onRemove(e.id)} />
          ))}
      </div>

      <div className="group-label">Alle Fehler nach Rolle</div>
      <input
        className="search"
        type="search"
        placeholder="Fehler suchen …"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {visibleGroups.length === 0 && <p className="muted">Kein Fehler gefunden.</p>}
      {visibleGroups.map((g) => {
        const sum = g.errors.reduce((n, e) => n + (counts[e.id] ?? 0), 0);
        return (
          <details key={g.id} className="acc" open={q.length > 0}>
            <summary>
              {g.title} {sum > 0 && <span className="chip chip--warn">{sum}</span>}
            </summary>
            <div className="list">
              {g.errors.map((e) => (
                <Row key={e.id} def={e} count={counts[e.id] ?? 0} onAdd={() => onAdd(e.id)} onRemove={() => onRemove(e.id)} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
