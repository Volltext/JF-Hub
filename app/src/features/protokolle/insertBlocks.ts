import { findParentNode, type Content, type Editor } from '@tiptap/core';
import type { Selection } from '@tiptap/pm/state';

/**
 * Stelle direkt hinter der Tabelle, in der die Auswahl steht (zwischen zwei Blöcken), oder null, wenn sie in keiner Tabelle steht.
 * Zellen nehmen nur Absätze und Listen auf; Fotos, Dateien, Handschrift und Trennlinien müssen hinter die Tabelle.
 */
export function afterTable(selection: Selection): number | null {
  const table = findParentNode((n) => n.type.name === 'table')(selection);
  return table ? table.pos + table.node.nodeSize : null;
}

/**
 * Fügt Blöcke (Foto, Datei, Handschrift, Trennlinie) an der Cursorstelle ein, in einer Tabelle hinter der Tabelle. Sonst ginge das
 * Eingefügte verloren: Der Editor kann es in einer Zelle nicht unterbringen und tut stumm nichts.
 */
export function insertBlocks(editor: Editor, content: Content): boolean {
  const at = afterTable(editor.state.selection);
  const chain = editor.chain().focus();
  return (at === null ? chain.insertContent(content) : chain.insertContentAt(at, content)).run();
}
