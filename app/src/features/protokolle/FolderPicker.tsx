import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Folder, FolderOpen } from 'lucide-react';
import { Sheet } from '@/core/ui/components';
import { ROOT, folderTree, liveFolders } from './folders';

/** Auswahl eines Zielordners (oder der obersten Ebene). `exclude` blendet Ordner aus, z. B. beim Verschieben eines Ordners in sich selbst. */
export function FolderPicker(props: { title: string; current: string; exclude?: Set<string>; onPick: (folderId: string) => void; onClose: () => void }) {
  const folders = useLiveQuery(liveFolders, []);
  if (!folders) return null;
  const rows = [{ id: ROOT, name: 'Alle Protokolle (oberste Ebene)', depth: 0 }, ...folderTree(folders, props.exclude).map(({ folder, depth }) => ({ id: folder.id, name: folder.name, depth }))];
  return (
    <Sheet title={props.title} onClose={props.onClose}>
      <div className="list">
        {rows.map((r) => (
          <button
            key={r.id || 'root'}
            type="button"
            className="toggle"
            aria-pressed={r.id === props.current}
            style={{ paddingLeft: `calc(var(--s-4) + ${r.depth} * var(--s-5))` }}
            onClick={() => props.onPick(r.id)}
          >
            {r.id === props.current ? <Check size={18} /> : r.id === ROOT ? <FolderOpen size={18} /> : <Folder size={18} />}
            {r.name}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
