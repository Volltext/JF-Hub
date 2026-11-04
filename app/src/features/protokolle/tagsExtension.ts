import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node } from '@tiptap/pm/model';
import { TAG_SOURCE } from './tags';

/** Markiert #Tags im Text. Nur Anzeige (Dekoration): Das Dokument selbst bleibt unverändert, es wird nichts geschrieben. */
function decorate(doc: Node): DecorationSet {
  const found: Decoration[] = [];
  const re = new RegExp(TAG_SOURCE, 'gu');
  doc.descendants((node, pos, parent) => {
    // Keine Tags in Code, Links und Überschriften-Markierungen: dort ist „#“ Teil des Inhalts.
    if (!node.isText || !node.text || parent?.type.name === 'codeBlock') return;
    if (node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return;
    re.lastIndex = 0;
    for (const m of node.text.matchAll(re)) {
      const from = pos + (m.index ?? 0);
      found.push(Decoration.inline(from, from + m[0].length, { class: 'ed-tag' }));
    }
  });
  return DecorationSet.create(doc, found);
}

export const TagHighlight = Extension.create({
  name: 'tagHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tagHighlight'),
        state: {
          init: (_config, state) => decorate(state.doc),
          apply: (tr, old, _oldState, newState) => (tr.docChanged ? decorate(newState.doc) : old),
        },
        props: { decorations(state) { return this.getState(state); } },
      }),
    ];
  },
});
