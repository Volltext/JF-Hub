import { Route, Routes } from 'react-router-dom';
import './protokolle.css';
import { ProtokollList } from './ProtokollList';
import { ProtokollEditor } from './ProtokollEditor';

/** Unterrouten: Liste und Editor für ein Protokoll. */
export function ProtokollePage() {
  return (
    <Routes>
      <Route index element={<ProtokollList />} />
      <Route path="o/:folderId" element={<ProtokollList />} />
      <Route path=":id" element={<ProtokollEditor />} />
    </Routes>
  );
}
