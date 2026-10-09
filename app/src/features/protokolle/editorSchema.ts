import { getSchema, type JSONContent } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { Highlight } from '@tiptap/extension-highlight';
import { Link } from '@tiptap/extension-link';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { InkNode } from '@/features/ink/InkNode';
import { FileNode, PhotoNode } from '@/features/attachments/AttachmentNodes';
import { allowedLink } from './linkUrl';

export { SCHEMA_VERSION } from './schemaVersion';

/** Zellen enthalten Absätze und Listen, keine Tabellen, Fotos oder Zeichnungen: So bleibt das Layout (auch im PDF) beherrschbar. */
const CELL_CONTENT = '(paragraph | bulletList | orderedList | taskList)+';

const hexColor = (v: unknown): string | null => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);

/**
 * Hervorhebung. Die Farbe (`color`) bietet der Editor noch nicht an, das Attribut ist aber deklariert: Eine spätere Farbauswahl
 * bräche sonst ältere Apps, die beim Speichern unbekannte Attribute fallen lassen. Ausgegeben wird nur `#rrggbb`.
 */
const Marker = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => hexColor(el.getAttribute('data-color')),
        renderHTML: (attrs: Record<string, unknown>) => {
          const color = hexColor(attrs.color);
          return color ? { 'data-color': color, style: `background-color: ${color}; color: inherit` } : {};
        },
      },
    };
  },
});

/**
 * Links: nur http(s), mailto und tel (`allowedLink`). Das Öffnen steuert der Editor selbst (`openOnClick: false`): Tippen am Handy
 * soll den Cursor setzen. Weitergetippter Text am Ende eines Links gehört nicht mehr dazu (`inclusive: false`).
 */
const SafeLink = Link.extend({ inclusive: false }).configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  defaultProtocol: 'https',
  isAllowedUri: (url) => allowedLink(url),
});

/** Die Erweiterungen, die das Dokumentformat bestimmen (Knoten und Markierungen). Der Editor ergänzt sie nur um reine Oberfläche. */
export const EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
  SafeLink,
  Marker,
  TaskList,
  TaskItem.configure({ nested: true }),
  // Spaltenbreiten gibt es nicht (`resizable: false`); `cellMinWidth` sorgt dafür, dass viele Spalten waagerecht scrollen statt zu zerquetschen.
  Table.configure({ resizable: false, cellMinWidth: 96 }),
  TableRow,
  TableHeader.extend({ content: CELL_CONTENT }),
  TableCell.extend({ content: CELL_CONTENT }),
  InkNode,
  PhotoNode,
  FileNode,
];

let schema: Schema | undefined;
const appSchema = (): Schema => (schema ??= getSchema(EXTENSIONS));

/**
 * Kennt diese App-Version alle Knoten und Markierungen des Dokuments?
 *
 * Wichtig, weil ein Editor mit unbekanntem Inhalt (etwa einem Element aus einer neueren Version) still ein leeres Dokument anzeigt,
 * und der nächste Autosave würde den Inhalt auf dem Server überschreiben. Solche Protokolle werden nur gelesen, nie geschrieben.
 * Unbekannte *Attribute* bekannter Knoten fallen hier nicht auf; die Knoten sind deshalb so definiert, dass sie künftige durchreichen.
 */
export function schemaAccepts(content: JSONContent | undefined): boolean {
  if (!content) return true;
  try {
    appSchema().nodeFromJSON(content);
    return true;
  } catch {
    return false;
  }
}
