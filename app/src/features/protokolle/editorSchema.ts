import { getSchema, type JSONContent } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { InkNode } from '@/features/ink/InkNode';
import { FileNode, PhotoNode } from '@/features/attachments/AttachmentNodes';

export { SCHEMA_VERSION } from './schemaVersion';

/** Die Erweiterungen, die das Dokumentformat bestimmen (Knoten und Markierungen). Der Editor ergänzt sie nur um reine Oberfläche. */
export const EXTENSIONS = [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }), TaskList, TaskItem.configure({ nested: true }), InkNode, PhotoNode, FileNode];

let schema: Schema | undefined;
const appSchema = (): Schema => (schema ??= getSchema(EXTENSIONS));

/**
 * Kennt diese App-Version alle Knoten und Markierungen des Dokuments?
 *
 * Wichtig, weil ein Editor mit unbekanntem Inhalt (etwa einer Tabelle aus einer neueren Version) still ein leeres Dokument anzeigt,
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
