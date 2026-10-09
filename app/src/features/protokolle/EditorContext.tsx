import { findParentNode, type Editor } from '@tiptap/core';
import { TableMap } from '@tiptap/pm/tables';
import { useEditorState } from '@tiptap/react';
import { ExternalLink, Link2, Pencil, Unlink } from 'lucide-react';
import { confirmDialog } from '@/core/ui/dialog';
import { MAX_TABLE_COLS, MAX_TABLE_ROWS } from './editorSchema';
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
  run: (e: Editor) => unknown;
  disabled?: (t: TableInfo) => boolean;
  pressed?: (t: TableInfo) => boolean;
  danger?: boolean;
}

/** Löscht die Tabelle, in der der Cursor steht; enthält sie Text, fragt der Editor vorher nach (Rückgängig liegt am Handy nicht griffbereit). */
async function deleteTable(e: Editor): Promise<void> {
  const table = findParentNode((n) => n.type.name === 'table')(e.state.selection);
  if (table?.node.textContent.trim() && !(await confirmDialog('Diese Tabelle samt ihrem Inhalt löschen?', { title: 'Tabelle löschen', confirmLabel: 'Löschen', danger: true }))) return;
  e.chain().focus().deleteTable().run();
}

const TABLE_OPS: TableOp[] = [
  { label: 'Zeile oben einfügen', text: '+ Zeile oben', run: (e) => e.chain().focus().addRowBefore().run(), disabled: (t) => t.rows >= MAX_TABLE_ROWS },
  { label: 'Zeile unten einfügen', text: '+ Zeile unten', run: (e) => e.chain().focus().addRowAfter().run(), disabled: (t) => t.rows >= MAX_TABLE_ROWS },
  // Die letzte Zeile oder Spalte zu löschen würde die ganze Tabelle löschen: Dafür gibt es „Tabelle löschen“.
  { label: 'Zeile löschen', text: '− Zeile', run: (e) => e.chain().focus().deleteRow().run(), disabled: (t) => t.rows <= 1 },
  { label: 'Spalte links einfügen', text: '+ Spalte links', run: (e) => e.chain().focus().addColumnBefore().run(), disabled: (t) => t.cols >= MAX_TABLE_COLS },
  { label: 'Spalte rechts einfügen', text: '+ Spalte rechts', run: (e) => e.chain().focus().addColumnAfter().run(), disabled: (t) => t.cols >= MAX_TABLE_COLS },
  { label: 'Spalte löschen', text: '− Spalte', run: (e) => e.chain().focus().deleteColumn().run(), disabled: (t) => t.cols <= 1 },
  { label: 'Kopfzeile ein oder aus', text: 'Kopfzeile', run: (e) => e.chain().focus().toggleHeaderRow().run(), pressed: (t) => t.header },
  { label: 'Tabelle löschen', text: 'Tabelle löschen', run: deleteTable, danger: true },
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
    // Symbole statt Text: Am Handy bleibt so Platz für das Ziel, das die Leiste zeigen soll.
    return (
      <div className="ed-context" role="toolbar" aria-label="Link">
        <span className="ed-context__label" title={ctx.link}>
          <Link2 size={16} aria-hidden />
          <span>{displayUrl(ctx.link, 60) || 'Link'}</span>
        </span>
        <button type="button" className="ed-tool" aria-label="Link öffnen" title="Link öffnen" disabled={!allowedLink(ctx.link)} onMouseDown={keepFocus} onClick={() => openLink(ctx.link)}>
          <ExternalLink size={20} />
        </button>
        <button type="button" className="ed-tool" aria-label="Link ändern" title="Link ändern" onMouseDown={keepFocus} onClick={onEditLink}>
          <Pencil size={20} />
        </button>
        <button type="button" className="ed-tool" aria-label="Link entfernen" title="Link entfernen" onMouseDown={keepFocus} onClick={() => editor.chain().focus().unsetLink().run()}>
          <Unlink size={20} />
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
          onClick={() => void op.run(editor)}
        >
          {op.text}
        </button>
      ))}
    </div>
  );
}
