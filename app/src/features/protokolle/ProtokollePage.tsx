import { Route, Routes, matchPath, useLocation } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { useMedia } from '@/core/ui/useMedia';
import './protokolle.css';
import { ProtokollList } from './ProtokollList';
import { ProtokollEditor } from './ProtokollEditor';
import { ProtokollPapierkorb } from './ProtokollPapierkorb';

/** Breit genug für Liste und Editor nebeneinander (neben der Seitenleiste der App). */
const SPLIT = '(min-width: 1240px)';

const BASE = '/protokolle';

/**
 * Unterrouten: Liste, Papierkorb und Editor für ein Protokoll. Auf breiten Bildschirmen stehen Liste und Editor wie bei Bear
 * nebeneinander: links alle Protokolle, rechts das geöffnete. Schmal bleibt es bei einer Seite nach der anderen.
 */
export function ProtokollePage() {
  const split = useMedia(SPLIT);
  const { pathname } = useLocation();
  const folder = matchPath(`${BASE}/o/:folderId`, pathname)?.params.folderId;
  const open = matchPath(`${BASE}/:id`, pathname)?.params.id;
  // „o“ und „papierkorb“ sind keine Protokolle.
  const activeId = open && open !== 'o' && open !== 'papierkorb' ? open : undefined;

  if (split && pathname !== `${BASE}/papierkorb`) {
    return (
      <div className="proto-split">
        <aside className="proto-split__list" aria-label="Protokolle">
          <ProtokollList split folder={folder} activeId={activeId} />
        </aside>
        <section className="proto-split__main">
          <Routes>
            <Route index element={<SplitEmpty />} />
            <Route path="o/:folderId" element={<SplitEmpty />} />
            <Route path=":id" element={<ProtokollEditor />} />
          </Routes>
        </section>
      </div>
    );
  }

  return (
    <Routes>
      <Route index element={<ProtokollList />} />
      <Route path="o/:folderId" element={<ProtokollList />} />
      <Route path="papierkorb" element={<ProtokollPapierkorb />} />
      <Route path=":id" element={<ProtokollEditor />} />
    </Routes>
  );
}

function SplitEmpty() {
  return (
    <div className="proto-split__empty">
      <FileText size={34} />
      <strong>Wähle ein Protokoll</strong>
      <p className="muted">oder lege mit „Neu“ ein neues an. Mit #Tags im Text findest du es später wieder.</p>
    </div>
  );
}
