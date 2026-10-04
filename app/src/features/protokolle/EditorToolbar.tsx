import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useState } from 'react';
import { AttachSheet } from '@/features/attachments/AttachSheet';
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  NotebookPen,
  Paperclip,
  PenLine,
  Quote,
  Redo2,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react';

interface Tool {
  id: string;
  label: string;
  /** Tastenkürzel für den Tooltip (am Rechner). */
  keys?: string;
  icon: LucideIcon;
  run: (e: Editor, ui: { openAttach: () => void }) => void;
  active?: (e: Editor) => boolean;
  disabled?: (e: Editor) => boolean;
}

const TOOLS: (Tool | 'sep')[] = [
  { id: 'h1', label: 'Überschrift 1', keys: 'Strg+Alt+1', icon: Heading1, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive('heading', { level: 1 }) },
  { id: 'h2', label: 'Überschrift 2', keys: 'Strg+Alt+2', icon: Heading2, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive('heading', { level: 2 }) },
  { id: 'h3', label: 'Überschrift 3', keys: 'Strg+Alt+3', icon: Heading3, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive('heading', { level: 3 }) },
  'sep',
  { id: 'bold', label: 'Fett', keys: 'Strg+B', icon: Bold, run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
  { id: 'italic', label: 'Kursiv', keys: 'Strg+I', icon: Italic, run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
  { id: 'underline', label: 'Unterstrichen', keys: 'Strg+U', icon: Underline, run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e.isActive('underline') },
  'sep',
  { id: 'ul', label: 'Aufzählung', keys: 'Strg+Umschalt+8', icon: List, run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
  { id: 'ol', label: 'Nummerierung', keys: 'Strg+Umschalt+7', icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
  { id: 'task', label: 'Checkliste', keys: 'Strg+Umschalt+9', icon: ListChecks, run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e.isActive('taskList') },
  'sep',
  { id: 'quote', label: 'Zitat / Hinweis', icon: Quote, run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
  { id: 'hr', label: 'Trennlinie', icon: Minus, run: (e) => e.chain().focus().setHorizontalRule().run() },
  'sep',
  { id: 'ink', label: 'Handschrift einfügen', icon: PenLine, run: (e) => e.commands.insertInk('block') },
  { id: 'inkpage', label: 'Handschrift-Seite einfügen', icon: NotebookPen, run: (e) => e.commands.insertInk('page') },
  { id: 'attach', label: 'Foto oder Datei anhängen', icon: Paperclip, run: (_e, ui) => ui.openAttach() },
  'sep',
  { id: 'undo', label: 'Rückgängig', keys: 'Strg+Z', icon: Undo2, run: (e) => e.chain().focus().undo().run(), disabled: (e) => !e.can().undo() },
  { id: 'redo', label: 'Wiederholen', keys: 'Strg+Y', icon: Redo2, run: (e) => e.chain().focus().redo().run(), disabled: (e) => !e.can().redo() },
];

/** Formatierungsleiste: am Rechner oben am Rand haftend, auf dem Handy über der Tastatur. */
export function EditorToolbar({ editor }: { editor: Editor }) {
  const [attachOpen, setAttachOpen] = useState(false);
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

  return (
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
            disabled={s?.disabled}
            // Fokus im Editor halten, damit die Bildschirmtastatur offen bleibt.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => t.run(editor, { openAttach: () => setAttachOpen(true) })}
          >
            <Icon size={20} />
          </button>
        );
      })}
      {attachOpen && <AttachSheet editor={editor} onClose={() => setAttachOpen(false)} />}
    </div>
  );
}
