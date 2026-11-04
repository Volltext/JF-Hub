import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/core/db/db';
import { formatDate } from '@/core/domain/format';
import { Sheet } from '@/core/ui/components';

/** Auswahl eines vorhandenen Protokolls (neueste zuerst, mit Suche im Titel). */
export function ProtocolPicker({ title, onPick, onClose, exclude = [] }: { title: string; onPick: (id: string) => void; onClose: () => void; exclude?: string[] }) {
  const [filter, setFilter] = useState('');
  const all = useLiveQuery(async () => (await db.protokolle.toArray()).filter((p) => p.deleted === 0).sort((a, b) => b.updatedAt - a.updatedAt), []);
  const f = filter.trim().toLowerCase();
  const list = (all ?? []).filter((p) => !exclude.includes(p.id) && (!f || (p.title || 'Ohne Titel').toLowerCase().includes(f))).slice(0, 60);
  return (
    <Sheet title={title} onClose={onClose}>
      <input className="search" type="search" placeholder="Protokoll suchen" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Protokoll suchen" />
      <div className="list">
        {all && list.length === 0 && <p className="muted">Kein Protokoll gefunden.</p>}
        {list.map((p) => (
          <button key={p.id} type="button" className="item item--top item__btn" onClick={() => onPick(p.id)}>
            <div className="item__main">
              <div className="item__title">{p.title || 'Ohne Titel'}</div>
              <div className="item__sub">{p.datum ? formatDate(p.datum) : ''}</div>
            </div>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
