import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { ySyncPluginKey } from '@tiptap/y-tiptap';

/**
 * Plugins, die beim Öffnen oder bei Änderungen anderer Geräte etwas ins Dokument schreiben, wären im gemeinsamen Dokument ein Fehler:
 * Jedes Öffnen würde das Protokoll ändern (neue Änderungszeit, Übertragung), und zwei Geräte könnten sich gegenseitig immer wieder
 * dieselbe Korrektur schicken. Die Erweiterungen hier reagieren deshalb nur auf eigene Änderungen.
 */

/** Stammt die Transaktion aus dem geteilten Dokument (erstes Rendern oder Änderung eines anderen Geräts)? */
export const isRemote = (tr: Transaction): boolean => !!tr.getMeta(ySyncPluginKey);

/** Ändert diese Gruppe von Transaktionen den Text durch eine eigene Eingabe? */
export const hasLocalDocChange = (transactions: readonly Transaction[]): boolean => transactions.some((tr) => tr.docChanged && !isRemote(tr));

/** Hüllt ein Plugin so ein, dass sein `appendTransaction` nur nach eigenen Änderungen des Textes läuft. */
export function localOnly(plugin: Plugin): Plugin {
  const append = plugin.spec.appendTransaction;
  if (!append) return plugin;
  return new Plugin({
    ...plugin.spec,
    appendTransaction: (transactions, oldState, newState) => (hasLocalDocChange(transactions) ? append.call(plugin, transactions, oldState, newState) : null),
  });
}

/**
 * Hängt einen leeren Absatz an, wenn das Dokument nicht mit einem Absatz endet (zum Beispiel nach einem Foto), damit man dahinter
 * weiterschreiben kann. Wie `TrailingNode` aus TipTap, aber nur nach einer eigenen Änderung des Textes: Öffnen, Anklicken und
 * Änderungen anderer Geräte schreiben nichts.
 */
export const LocalTrailingNode = Extension.create({
  name: 'localTrailingNode',

  addProseMirrorPlugins() {
    const paragraph = this.editor.schema.topNodeType.contentMatch.defaultType;
    return [
      new Plugin({
        key: new PluginKey('localTrailingNode'),
        appendTransaction: (transactions, _oldState, state) => {
          if (!paragraph || !hasLocalDocChange(transactions)) return null;
          if (transactions.some((tr) => tr.getMeta('skipTrailingNode'))) return null;
          const last = state.doc.lastChild;
          if (!last || last.type === paragraph) return null;
          return state.tr.insert(state.doc.content.size, paragraph.create());
        },
      }),
    ];
  },
});
