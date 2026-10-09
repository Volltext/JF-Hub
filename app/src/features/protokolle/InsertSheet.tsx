import { useState, type FormEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { Minus, NotebookPen, PenLine, Quote, Table2 } from 'lucide-react';
import { Button, MenuGroup, MenuRow, Segmented, Sheet } from '@/core/ui/components';
import { insertBlocks } from './insertBlocks';

export const TABLE_MAX_ROWS = 20;
export const TABLE_MAX_COLS = 6;

const clamp = (v: string, max: number) => Math.min(max, Math.max(1, Math.round(Number(v)) || 1));

/** Größe der neuen Tabelle: Zeilen, Spalten, Kopfzeile. */
function TableForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [rows, setRows] = useState('3');
  const [cols, setCols] = useState('3');
  const [header, setHeader] = useState(true);

  function submit(e: FormEvent) {
    e.preventDefault();
    onClose();
    editor.chain().focus().insertTable({ rows: clamp(rows, TABLE_MAX_ROWS), cols: clamp(cols, TABLE_MAX_COLS), withHeaderRow: header }).run();
  }

  return (
    <Sheet title="Tabelle einfügen" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Zeilen (höchstens {TABLE_MAX_ROWS})</span>
          <input type="number" inputMode="numeric" min={1} max={TABLE_MAX_ROWS} value={rows} onChange={(e) => setRows(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
        <label className="field">
          <span>Spalten (höchstens {TABLE_MAX_COLS})</span>
          <input type="number" inputMode="numeric" min={1} max={TABLE_MAX_COLS} value={cols} onChange={(e) => setCols(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
        <Segmented
          value={header ? 'mit' : 'ohne'}
          options={[
            { value: 'mit', label: 'Mit Kopfzeile' },
            { value: 'ohne', label: 'Ohne Kopfzeile' },
          ]}
          onChange={(v) => setHeader(v === 'mit')}
        />
        <Button variant="primary" type="submit">
          Tabelle einfügen
        </Button>
        <p className="muted">Weitere Zeilen und Spalten fügst du danach über die Leiste „Tabelle“ hinzu.</p>
      </form>
    </Sheet>
  );
}

/** „Einfügen“: Elemente, die kein Zeichenformat sind (Tabelle, Zitat, Trennlinie, Handschrift). */
export function InsertSheet({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [step, setStep] = useState<'menu' | 'table'>('menu');
  if (step === 'table') return <TableForm editor={editor} onClose={onClose} />;

  // Zellen nehmen nur Absätze und Listen auf: In einer Tabelle gibt es weder Tabelle noch Zitat, und Trennlinie und Handschrift kommen
  // hinter die Tabelle (der Editor würde die Tabelle sonst an der Cursorstelle zerteilen).
  const inTable = editor.isActive('table');
  const run = (fn: (e: Editor) => unknown) => () => {
    onClose();
    fn(editor);
  };
  return (
    <Sheet title="Einfügen" onClose={onClose}>
      {inTable && <p className="muted">Der Cursor steht in einer Tabelle. Trennlinie und Handschrift kommen hinter die Tabelle.</p>}
      <MenuGroup>
        {!inTable && <MenuRow icon={Table2} title="Tabelle" sub="Zeilen und Spalten, mit oder ohne Kopfzeile" onClick={() => setStep('table')} />}
        {!inTable && <MenuRow icon={Quote} title="Zitat / Hinweis" sub="Hebt einen Absatz hervor" onClick={run((e) => e.chain().focus().toggleBlockquote().run())} />}
        <MenuRow
          icon={Minus}
          title="Trennlinie"
          sub="Waagerechte Linie"
          onClick={run((e) => (inTable ? insertBlocks(e, [{ type: 'horizontalRule' }, { type: 'paragraph' }]) : e.chain().focus().setHorizontalRule().run()))}
        />
        <MenuRow icon={PenLine} title="Handschrift" sub="Zeichenfläche im Text" onClick={run((e) => e.commands.insertInk('block'))} />
        <MenuRow icon={NotebookPen} title="Handschrift-Seite" sub="Eine ganze Seite zum Schreiben und Zeichnen" onClick={run((e) => e.commands.insertInk('page'))} />
      </MenuGroup>
    </Sheet>
  );
}
