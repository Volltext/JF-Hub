import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { AttachSheet } from '@/features/attachments/AttachSheet';
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Keyboard,
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
import { KeyboardSheet, MOD } from './KeyboardSheet';
import { LinkSheet } from './LinkSheet';

interface Ui {
  openAttach: () => void;
  openInsert: () => void;
  openLink: () => void;
  openKeys: () => void;
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

/** Überschriften gibt es in Tabellenzellen nicht (Zellen nehmen Absätze und Listen auf); der Knopf würde dort nichts tun oder eine Liste auflösen. */
const notInTable = (e: Editor) => e.isActive('table');

/**
 * Die Reihenfolge richtet sich nach dem Handy, wo nur etwa sieben Knöpfe ohne Wischen sichtbar sind: Vorn steht, was beim Notieren
 * am häufigsten gebraucht wird (Fett, Kursiv, Aufzählung, Checkliste, Anhang, Einfügen), dann Rückgängig – auf dem Handy gibt es
 * dafür sonst keinen Weg. Dahinter die Feinheiten. Ein Schatten am Rand zeigt, dass sich die Leiste weiterwischen lässt.
 */
const TOOLS: (Tool | 'sep')[] = [
  { id: 'bold', label: 'Fett', keys: 'Strg+B', icon: Bold, run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
  { id: 'italic', label: 'Kursiv', keys: 'Strg+I', icon: Italic, run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
  'sep',
  { id: 'ul', label: 'Aufzählung', keys: 'Strg+Umschalt+8', icon: List, run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
  { id: 'task', label: 'Checkliste', keys: 'Strg+Umschalt+9', icon: ListChecks, run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e.isActive('taskList') },
  'sep',
  { id: 'attach', label: 'Foto oder Datei anhängen', icon: Paperclip, run: (_e, ui) => ui.openAttach(), dialog: true },
  { id: 'insert', label: 'Einfügen', icon: Plus, run: (_e, ui) => ui.openInsert(), dialog: true },
  'sep',
  { id: 'undo', label: 'Rückgängig', keys: 'Strg+Z', icon: Undo2, run: (e) => e.chain().focus().undo().run(), disabled: (e) => !e.can().undo() },
  { id: 'redo', label: 'Wiederholen', keys: 'Strg+Y', icon: Redo2, run: (e) => e.chain().focus().redo().run(), disabled: (e) => !e.can().redo() },
  'sep',
  { id: 'ol', label: 'Nummerierung', keys: 'Strg+Umschalt+7', icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
  { id: 'underline', label: 'Unterstrichen', keys: 'Strg+U', icon: Underline, run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e.isActive('underline') },
  { id: 'marker', label: 'Hervorheben', keys: 'Strg+Umschalt+H', icon: Highlighter, run: (e) => e.chain().focus().toggleHighlight().run(), active: (e) => e.isActive('highlight') },
  { id: 'link', label: 'Link', keys: 'Strg+K', icon: Link2, run: (_e, ui) => ui.openLink(), active: (e) => e.isActive('link'), dialog: true },
  'sep',
  { id: 'h1', label: 'Überschrift 1', keys: 'Strg+Alt+1', icon: Heading1, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive('heading', { level: 1 }), disabled: notInTable },
  { id: 'h2', label: 'Überschrift 2', keys: 'Strg+Alt+2', icon: Heading2, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive('heading', { level: 2 }), disabled: notInTable },
  { id: 'h3', label: 'Überschrift 3', keys: 'Strg+Alt+3', icon: Heading3, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive('heading', { level: 3 }), disabled: notInTable },
  'sep',
  { id: 'keys', label: 'Tastatur & Autokorrektur', keys: 'Strg+#', icon: Keyboard, run: (_e, ui) => ui.openKeys(), dialog: true },
];

/** Abstand der Cursorzeile zu den Rändern beim Scrollen (ProseMirror `scrollMargin`/`scrollThreshold`); die Leiste passt ihn an. */
export interface ScrollMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
const BASE_MARGINS: ScrollMargins = { top: 88, bottom: 96, left: 8, right: 8 };
export const defaultScrollMargins = (): ScrollMargins => ({ ...BASE_MARGINS });
/** So viel Luft bleibt zwischen Cursorzeile und Leiste: gut eine Zeile, damit man sieht, was als Nächstes kommt. */
const GAP = 40;

/** Strg+# (deutsche Tastatur) oder Strg+/ (englische): Strg+Umschalt+7 ist die Nummerierung und bleibt unberührt. */
const isHelpKey = (e: KeyboardEvent) => (e.key === '#' || (e.key === '/' && !e.shiftKey)) && !e.altKey;

/**
 * Formatierungsleiste: am Rechner oben am Rand haftend, auf dem Handy über der Tastatur. Darüber (Handy) oder darunter (Rechner)
 * steht die Kontextzeile für Links und Tabellen.
 */
export function EditorToolbar({ editor, scrollMargins }: { editor: Editor; scrollMargins?: ScrollMargins }) {
  const dock = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState<'attach' | 'insert' | 'link' | 'keys' | null>(null);
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
  const ui: Ui = { openAttach: () => setSheet('attach'), openInsert: () => setSheet('insert'), openLink: () => setSheet('link'), openKeys: () => setSheet('keys') };

  // Die Leiste ist nicht immer gleich hoch: In der Android-App kommt ohne Tastatur der Rand der Navigationsleiste dazu, in Links und
  // Tabellen die Kontextzeile. Fester Abstand reichte dort nicht, die Zeile mit dem Cursor verschwand halb hinter der Leiste.
  useEffect(() => {
    const el = dock.current;
    if (!el || !scrollMargins || typeof ResizeObserver === 'undefined' || typeof matchMedia !== 'function') return;
    const coarse = matchMedia('(pointer: coarse)');
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      // Am Handy haftet die Leiste unten, am Rechner oben (mit etwas Abstand zum Rand).
      if (coarse.matches) Object.assign(scrollMargins, { top: BASE_MARGINS.top, bottom: Math.max(BASE_MARGINS.bottom, Math.ceil(h) + GAP) });
      else Object.assign(scrollMargins, { top: Math.max(BASE_MARGINS.top, Math.ceil(h) + GAP), bottom: BASE_MARGINS.bottom });
    };
    measure();
    const ro = new ResizeObserver(measure);
    // Die ganze Box beobachten: Der Rand der Navigationsleiste kommt als Innenabstand dazu, die Inhaltsbox bleibt gleich.
    ro.observe(el, { box: 'border-box' });
    coarse.addEventListener('change', measure);
    return () => {
      ro.disconnect();
      coarse.removeEventListener('change', measure);
    };
  }, [scrollMargins]);

  // Geht die Bildschirmtastatur auf (oder ändert ihre Höhe), schrumpft die Seite. Android schiebt das Eingabefeld dabei nur knapp über
  // die Tastatur – also unter die Leiste. Danach den Cursor noch einmal mit dem richtigen Abstand ins Bild holen.
  useEffect(() => {
    const vp = window.visualViewport;
    if (!vp) return;
    let frame = 0;
    let lastHeight = vp.height;
    const onResize = () => {
      if (Math.abs(vp.height - lastHeight) < 1) return;
      lastHeight = vp.height;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (editor.isFocused && !editor.isDestroyed) editor.commands.scrollIntoView();
      });
    };
    vp.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      vp.removeEventListener('resize', onResize);
    };
  }, [editor]);

  // Tastenkürzel, die ein Fenster öffnen: Strg+K (Link, nur im Text) und Strg+# (Übersicht, auch aus dem Titel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.defaultPrevented || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (isHelpKey(e)) {
        e.preventDefault();
        setSheet('keys');
      } else if (e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey && editor.isFocused) {
        e.preventDefault();
        setSheet('link');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  return (
    <>
      <div className="ed-dock" ref={dock}>
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
                title={t.keys ? `${t.label} (${t.keys.replace('Strg', MOD)})` : t.label}
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
      {sheet === 'keys' && <KeyboardSheet onClose={() => setSheet(null)} />}
    </>
  );
}
