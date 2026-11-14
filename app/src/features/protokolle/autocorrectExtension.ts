import { Extension, InputRule } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { autocorrect, type Correction } from './autocorrect';
import { autocorrectSetting, typingWithKeyboard } from './writing';

/** Text vor dem Cursor im Absatz; nicht-textliche Elemente (Zeilenumbruch, Bilder) zählen als Zeilenende. */
const LEAF = /%leaf%/g;

const active = () => autocorrectSetting.get() && typingWithKeyboard();

/**
 * Bindet die Autokorrektur (`autocorrect.ts`) an den Editor.
 *
 * - Beim Tippen als Eingaberegel: Die Rücktaste direkt danach nimmt die Korrektur zurück (wie in Textprogrammen); in Code
 *   und während einer Komposition der Bildschirmtastatur greift sie nicht (das regelt Tiptap).
 * - Bei Enter wird das letzte Wort des Absatzes geprüft, bevor der Absatz endet (Rückgängig dann mit Strg+Z).
 *
 * Nur beim Schreiben mit echter Tastatur: Mit der Bildschirmtastatur korrigiert die Tastatur-App selbst, und Änderungen am Text
 * während ihrer Wortvorschläge bringen manche Android-Tastaturen durcheinander. Abschaltbar je Gerät (`autocorrectSetting`).
 */
export const Autocorrect = Extension.create({
  name: 'autocorrect',
  // Vor Listen, Tabellen usw., damit Enter erst korrigiert und dann wie gewohnt weitermacht.
  priority: 1000,

  addInputRules() {
    return [
      new InputRule({
        find: (text) => {
          if (!active() || text.endsWith('\n')) return null;
          // „%leaf%“ steht bei Tiptap für Zeilenumbruch und Co.; korrigiert wird nur dahinter, die Längen bleiben dort gleich.
          const fix = autocorrect(text.replace(LEAF, '\n'));
          if (!fix || fix.length > text.length) return null;
          return { index: text.length - fix.length, text: text.slice(text.length - fix.length), data: fix };
        },
        handler: ({ state, range, match }) => {
          const fix = match.data as Correction | undefined;
          if (!fix || match[0] === fix.text) return null;
          state.tr.insertText(fix.text, range.from, range.to);
        },
        undoable: true,
      }),
    ];
  },

  addKeyboardShortcuts() {
    const atLineEnd = () => {
      if (!active()) return false;
      const { state, view } = this.editor;
      const $cursor = state.selection instanceof TextSelection ? state.selection.$cursor : null;
      if (!$cursor || view.composing || $cursor.parent.type.spec.code || $cursor.marks().some((m) => m.type.spec.code)) return false;
      const text = $cursor.parent.textBetween(Math.max(0, $cursor.parentOffset - 500), $cursor.parentOffset, undefined, '\n');
      const fix = autocorrect(text, true);
      if (fix) view.dispatch(state.tr.insertText(fix.text, $cursor.pos - fix.length, $cursor.pos));
      // Enter selbst macht danach weiter wie immer (neuer Absatz, neuer Listenpunkt).
      return false;
    };
    return { Enter: atLineEnd, 'Shift-Enter': atLineEnd };
  },
});
