import { Route, Routes, matchPath, useLocation } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { useMedia } from '@/core/ui/useMedia';
import './protokolle.css';
import { ProtokollList } from './ProtokollList';
import { ProtokollEditor } from './ProtokollEditor';
import { ProtokollPapierkorb } from './ProtokollPapierkorb';
import { listHiddenSetting, SPLIT_QUERY } from './writing';

const BASE = '/protokolle';

/**
 * Unterrouten: Liste, Papierkorb und Editor für ein Protokoll. Auf breiten Bildschirmen stehen Liste und Editor wie bei Bear
 * nebeneinander: links alle Protokolle, rechts das geöffnete. Schmal bleibt es bei einer Seite nach der anderen.
 */
export function ProtokollePage() {
  const split = useMedia(SPLIT_QUERY);
  const listHidden = listHiddenSetting.use();
  const { pathname } = useLocation();
  const folder = matchPath(`${BASE}/o/:folderId`, pathname)?.params.folderId;
  const open = matchPath(`${BASE}/:id`, pathname)?.params.id;
  // „o“ und „papierkorb“ sind keine Protokolle.
  const activeId = open && open !== 'o' && open !== 'papierkorb' ? open : undefined;

  if (split && pathname !== `${BASE}/papierkorb`) {
    // Zum Schreiben lässt sich die Liste ausblenden (Knopf im Editor, Strg+Umschalt+L); ohne geöffnetes Protokoll ist sie immer da.
    const focus = listHidden && !!activeId;
    return (
      <div className={`proto-split${focus ? ' proto-split--focus' : ''}`}>
        <aside className="proto-split__list" aria-label="Protokolle" hidden={focus}>
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
