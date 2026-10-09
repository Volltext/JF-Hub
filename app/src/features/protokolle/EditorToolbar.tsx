import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useState } from 'react';
import { AttachSheet } from '@/features/attachments/AttachSheet';
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Paperclip,
  Plus,
  Redo2,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { EditorContext } from './EditorContext';
import { InsertSheet } from './InsertSheet';
import { LinkSheet } from './LinkSheet';

interface Ui {
  openAttach: () => void;
  openInsert: () => void;
  openLink: () => void;
}

interface Tool {
  id: string;
  label: string;
  /** Tastenkürzel für den Tooltip (am Rechner). */
  keys?: string;
  icon: LucideIcon;
  run: (e: Editor, ui: Ui) => void;
  active?: (e: Editor) => boolean;
  disabled?: (e: Editor) => boolean;
  /** Öffnet ein Fenster (für Screenreader). */
  dialog?: boolean;
}

const TOOLS: (Tool | 'sep')[] = [
  { id: 'h1', label: 'Überschrift 1', keys: 'Strg+Alt+1', icon: Heading1, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive('heading', { level: 1 }) },
  { id: 'h2', label: 'Überschrift 2', keys: 'Strg+Alt+2', icon: Heading2, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive('heading', { level: 2 }) },
  { id: 'h3', label: 'Überschrift 3', keys: 'Strg+Alt+3', icon: Heading3, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive('heading', { level: 3 }) },
  'sep',
  { id: 'bold', label: 'Fett', keys: 'Strg+B', icon: Bold, run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
  { id: 'italic', label: 'Kursiv', keys: 'Strg+I', icon: Italic, run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
  { id: 'underline', label: 'Unterstrichen', keys: 'Strg+U', icon: Underline, run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e.isActive('underline') },
  { id: 'marker', label: 'Hervorheben', keys: 'Strg+Umschalt+H', icon: Highlighter, run: (e) => e.chain().focus().toggleHighlight().run(), active: (e) => e.isActive('highlight') },
  { id: 'link', label: 'Link', icon: Link2, run: (_e, ui) => ui.openLink(), active: (e) => e.isActive('link'), dialog: true },
  'sep',
  { id: 'ul', label: 'Aufzählung', keys: 'Strg+Umschalt+8', icon: List, run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
  { id: 'ol', label: 'Nummerierung', keys: 'Strg+Umschalt+7', icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
  { id: 'task', label: 'Checkliste', keys: 'Strg+Umschalt+9', icon: ListChecks, run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e.isActive('taskList') },
  'sep',
  { id: 'attach', label: 'Foto oder Datei anhängen', icon: Paperclip, run: (_e, ui) => ui.openAttach(), dialog: true },
  { id: 'insert', label: 'Einfügen', icon: Plus, run: (_e, ui) => ui.openInsert(), dialog: true },
  'sep',
  { id: 'undo', label: 'Rückgängig', keys: 'Strg+Z', icon: Undo2, run: (e) => e.chain().focus().undo().run(), disabled: (e) => !e.can().undo() },
  { id: 'redo', label: 'Wiederholen', keys: 'Strg+Y', icon: Redo2, run: (e) => e.chain().focus().redo().run(), disabled: (e) => !e.can().redo() },
];

/**
 * Formatierungsleiste: am Rechner oben am Rand haftend, auf dem Handy über der Tastatur. Darüber (Handy) oder darunter (Rechner)
 * steht die Kontextzeile für Links und Tabellen.
 */
export function EditorToolbar({ editor }: { editor: Editor }) {
  const [sheet, setSheet] = useState<'attach' | 'insert' | 'link' | null>(null);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const out: Record<string, { active: boolean; disabled: boolean }> = {};
      for (const t of TOOLS) {
        if (t === 'sep') continue;
        out[t.id] = { active: t.active?.(e) ?? false, disabled: t.disabled?.(e) ?? false };
      }
      return out;
    },
    equalityFn: (a, b) => !!a && !!b && Object.keys(a).every((k) => a[k]!.active === b[k]!.active && a[k]!.disabled === b[k]!.disabled),
  });
  const ui: Ui = { openAttach: () => setSheet('attach'), openInsert: () => setSheet('insert'), openLink: () => setSheet('link') };

  return (
    <>
      <div className="ed-dock">
        <div className="ed-toolbar" role="toolbar" aria-label="Formatierung">
          {TOOLS.map((t, i) => {
            if (t === 'sep') return <span key={`s${i}`} className="ed-toolbar__sep" aria-hidden />;
            const Icon = t.icon;
            const s = state[t.id];
            return (
              <button
                key={t.id}
                type="button"
                className="ed-tool"
                title={t.keys ? `${t.label} (${t.keys})` : t.label}
                aria-label={t.label}
                aria-pressed={t.active ? s?.active : undefined}
                aria-haspopup={t.dialog ? 'dialog' : undefined}
                disabled={s?.disabled}
                // Fokus im Editor halten, damit die Bildschirmtastatur offen bleibt.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => t.run(editor, ui)}
              >
                <Icon size={20} />
              </button>
            );
          })}
        </div>
        <EditorContext editor={editor} onEditLink={ui.openLink} />
      </div>
      {sheet === 'attach' && <AttachSheet editor={editor} onClose={() => setSheet(null)} />}
      {sheet === 'insert' && <InsertSheet editor={editor} onClose={() => setSheet(null)} />}
      {sheet === 'link' && <LinkSheet editor={editor} onClose={() => setSheet(null)} />}
    </>
  );
}
