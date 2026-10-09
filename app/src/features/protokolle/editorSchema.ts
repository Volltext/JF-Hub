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
import { localOnly } from './collab/localExtensions';
import { allowedLink, normalizeUrl } from './linkUrl';

export { SCHEMA_VERSION } from './schemaVersion';

/**
 * Zellen enthalten als direkte Kinder Absätze und Listen, keine Tabellen, Fotos oder Zeichnungen: So bleibt das Layout (auch im PDF)
 * beherrschbar. Tiefer verschachtelt (Liste in einer Zelle, darin ein Listenpunkt mit einer Tabelle) lässt das Schema mehr zu; die
 * Oberfläche legt das nicht an, und das PDF verschachtelt Tabellen in Zellen nicht.
 */
const CELL_CONTENT = '(paragraph | bulletList | orderedList | taskList)+';

/** Grenzen einer Tabelle (Spalten, Zeilen), wie im PDF: Eine größere Tabelle ersetzt dort ein Hinweis. Auch die Grenzen der Spannweite einer Zelle. */
export const MAX_TABLE_COLS = 24;
export const MAX_TABLE_ROWS = 400;

/**
 * Spannweite (`colspan`, `rowspan`): ganze Zahl von 1 bis `max`. Der Editor legt für jede Spalte ein Element an, ein Protokoll mit
 * `colspan: 1000000` würde sonst jeden Editor, der es öffnet, minutenlang lahmlegen. Ein ungültiger Wert lässt das Protokoll nur
 * lesen (`schemaAccepts`); aus eingefügtem HTML wird die Spanne auf den erlaubten Bereich gekürzt.
 */
const span = (name: 'colspan' | 'rowspan', max: number) => ({
  default: 1,
  validate: (v: unknown) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max) throw new RangeError(`${name} muss eine ganze Zahl von 1 bis ${max} sein`);
  },
  parseHTML: (el: HTMLElement) => {
    const n = Number.parseInt(el.getAttribute(name) ?? '', 10);
    return n >= 1 ? Math.min(n, max) : 1;
  },
});

const hexColor = (v: unknown): string | null => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);

/**
 * Hervorhebung. Die Farbe (`color`) bietet der Editor noch nicht an, das Attribut ist aber deklariert: Eine spätere Farbauswahl
 * bräche sonst ältere Apps, die beim Speichern unbekannte Attribute fallen lassen. Ausgegeben wird nur `#rrggbb`.
 */
const Marker = Highlight.extend({
  // „==Text==“ soll nicht still zur Hervorhebung werden (Text wie „a == b == c“): Es gibt die Marker-Taste.
  addInputRules() {
    return [];
  },
  addPasteRules() {
    return [];
  },
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
 *
 * `class`, `target` und `rel` bleiben deklariert (ältere Apps reichen sie durch), werden aber nie ausgegeben oder aus eingefügtem
 * HTML übernommen: Sonst könnte ein Protokoll mit `class: "photo-lightbox"` die Oberfläche überdecken, und ein eingefügter Link
 * würde `target="_self"` oder ein leeres `rel` mitbringen. Ausgegeben werden immer die Werte aus den Optionen.
 *
 * `shouldAutoLink` entscheidet auch über das Einfügen einer Adresse über markiertem Text; dort prüft TipTap `isAllowedUri` nicht.
 */
const SafeLink = Link.extend({
  inclusive: false,
  // Die automatische Verlinkung läuft nur nach eigenen Eingaben: Bei einer Änderung eines anderen Geräts oder beim Öffnen würde sie
  // sonst ins gemeinsame Dokument schreiben (und das andere Gerät reagierte darauf).
  addProseMirrorPlugins() {
    return (this.parent?.() ?? []).map(localOnly);
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      class: { default: null, rendered: false, parseHTML: () => null },
      target: { default: '_blank', rendered: false, parseHTML: () => '_blank' },
      rel: { default: 'noopener noreferrer nofollow', rendered: false, parseHTML: () => 'noopener noreferrer nofollow' },
    };
  },
}).configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  defaultProtocol: 'https',
  isAllowedUri: (url) => allowedLink(url),
  shouldAutoLink: (url) => allowedLink(normalizeUrl(url) ?? ''),
});

/** Attribute einer Zelle: die von TipTap, die Spannen begrenzt. */
function cellAttributes(this: { parent?: () => Record<string, unknown> }) {
  return { ...this.parent?.(), colspan: span('colspan', MAX_TABLE_COLS), rowspan: span('rowspan', MAX_TABLE_ROWS) };
}

/**
 * Die Erweiterungen, die das Dokumentformat bestimmen (Knoten und Markierungen). Der Editor ergänzt sie um die Anbindung an das
 * geteilte Dokument und reine Oberfläche.
 *
 * Rückgängig/Wiederholen kommt von der Zusammenarbeit (macht nur eigene Schritte rückgängig), und der Absatz am Ende des Dokuments
 * von `LocalTrailingNode`: Die Standardfassungen würden auch beim Öffnen oder bei fremden Änderungen schreiben.
 */
export const EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, undoRedo: false, trailingNode: false }),
  SafeLink,
  Marker,
  TaskList,
  TaskItem.configure({ nested: true }),
  // Spaltenbreiten gibt es nicht (`resizable: false`); `cellMinWidth` sorgt dafür, dass viele Spalten waagerecht scrollen statt zu zerquetschen.
  Table.configure({ resizable: false, cellMinWidth: 96 }),
  TableRow,
  TableHeader.extend({ content: CELL_CONTENT, addAttributes: cellAttributes }),
  TableCell.extend({ content: CELL_CONTENT, addAttributes: cellAttributes }),
  InkNode,
  PhotoNode,
  FileNode,
];

let schema: Schema | undefined;
/** Das Schema des Editors dieser App-Version. */
export const appSchema = (): Schema => (schema ??= getSchema(EXTENSIONS));

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
