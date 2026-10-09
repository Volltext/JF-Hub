import { findParentNode, type Editor } from '@tiptap/core';
import { TableMap } from '@tiptap/pm/tables';
import { useEditorState } from '@tiptap/react';
import { Link2 } from 'lucide-react';
import { allowedLink, displayUrl } from './linkUrl';
import { openLink } from './openLink';

interface TableInfo {
  rows: number;
  cols: number;
  /** Die erste Zeile besteht aus Kopfzellen. */
  header: boolean;
}

interface Context {
  /** Ziel des Links, in dem der Cursor steht (leer: kein Link). */
  link: string;
  /** Die Tabelle, in der der Cursor steht. */
  table: TableInfo | null;
}

function contextOf(e: Editor): Context {
  const link = e.isActive('link') ? String(e.getAttributes('link').href ?? '') : '';
  const found = findParentNode((n) => n.type.name === 'table')(e.state.selection);
  let table: TableInfo | null = null;
  if (found) {
    const map = TableMap.get(found.node);
    table = { rows: map.height, cols: map.width, header: found.node.firstChild?.firstChild?.type.name === 'tableHeader' };
  }
  return { link, table };
}

const same = (a: Context, b: Context): boolean =>
  a.link === b.link && !!a.table === !!b.table && a.table?.rows === b.table?.rows && a.table?.cols === b.table?.cols && a.table?.header === b.table?.header;

interface TableOp {
  label: string;
  text: string;
  run: (e: Editor) => void;
  disabled?: (t: TableInfo) => boolean;
  pressed?: (t: TableInfo) => boolean;
  danger?: boolean;
}

const TABLE_OPS: TableOp[] = [
  { label: 'Zeile oben einfügen', text: '+ Zeile oben', run: (e) => e.chain().focus().addRowBefore().run() },
  { label: 'Zeile unten einfügen', text: '+ Zeile unten', run: (e) => e.chain().focus().addRowAfter().run() },
  // Die letzte Zeile oder Spalte zu löschen würde die ganze Tabelle löschen: Dafür gibt es „Tabelle löschen“.
  { label: 'Zeile löschen', text: '− Zeile', run: (e) => e.chain().focus().deleteRow().run(), disabled: (t) => t.rows <= 1 },
  { label: 'Spalte links einfügen', text: '+ Spalte links', run: (e) => e.chain().focus().addColumnBefore().run() },
  { label: 'Spalte rechts einfügen', text: '+ Spalte rechts', run: (e) => e.chain().focus().addColumnAfter().run() },
  { label: 'Spalte löschen', text: '− Spalte', run: (e) => e.chain().focus().deleteColumn().run(), disabled: (t) => t.cols <= 1 },
  { label: 'Kopfzeile ein oder aus', text: 'Kopfzeile', run: (e) => e.chain().focus().toggleHeaderRow().run(), pressed: (t) => t.header },
  { label: 'Tabelle löschen', text: 'Tabelle löschen', run: (e) => e.chain().focus().deleteTable().run(), danger: true },
];

/** Fokus im Editor halten, damit die Bildschirmtastatur offen bleibt. */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

/**
 * Kontextzeile über (Handy) oder unter (Rechner) der Werkzeugleiste: Steht der Cursor in einem Link, die Link-Leiste, sonst in
 * einer Tabelle die Tabellen-Leiste. Immer nur eine, damit am Handy neben der Tastatur Platz für den Text bleibt.
 */
export function EditorContext({ editor, onEditLink }: { editor: Editor; onEditLink: () => void }) {
  const ctx = useEditorState({ editor, selector: ({ editor: e }) => contextOf(e), equalityFn: (a, b) => !!b && same(a, b) });

  if (ctx.link) {
    return (
      <div className="ed-context" role="toolbar" aria-label="Link">
        <span className="ed-context__label" title={ctx.link}>
          <Link2 size={16} aria-hidden />
          <span>{displayUrl(ctx.link) || 'Link'}</span>
        </span>
        <button type="button" className="ed-chip" disabled={!allowedLink(ctx.link)} onMouseDown={keepFocus} onClick={() => openLink(ctx.link)}>
          Öffnen
        </button>
        <button type="button" className="ed-chip" onMouseDown={keepFocus} onClick={onEditLink}>
          Ändern
        </button>
        <button type="button" className="ed-chip" onMouseDown={keepFocus} onClick={() => editor.chain().focus().unsetLink().run()}>
          Entfernen
        </button>
      </div>
    );
  }

  const table = ctx.table;
  if (!table) return null;
  return (
    <div className="ed-context" role="toolbar" aria-label="Tabelle">
      {TABLE_OPS.map((op) => (
        <button
          key={op.label}
          type="button"
          className={`ed-chip${op.danger ? ' ed-chip--danger' : ''}`}
          aria-label={op.label}
          aria-pressed={op.pressed ? op.pressed(table) : undefined}
          disabled={op.disabled?.(table)}
          onMouseDown={keepFocus}
          onClick={() => op.run(editor)}
        >
          {op.text}
        </button>
      ))}
    </div>
  );
}
