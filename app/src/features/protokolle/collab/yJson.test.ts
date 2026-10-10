import { getSchema } from '@tiptap/core';
import { initProseMirrorDoc } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { EXTENSIONS } from '../editorSchema';
import { FIELD, docProblem, markName } from './yJson';

/**
 * `docProblem` muss alles ablehnen, was `@tiptap/y-tiptap` beim Binden aus dem geteilten Dokument löschen würde. Die Prüfung bildet dessen
 * Regeln nach, und jede Abweichung wäre ein Verlust für alle. Die Fälle hier schreibt kein Editor, wohl aber ein fehlerhafter Client oder ein
 * Eingriff von Hand; deshalb baut die Prüfung zusätzlich das Dokument auf einer Kopie auf und sieht nach, ob dabei etwas verschwindet.
 */
const schema = getSchema(EXTENSIONS);

/** Ein Dokument mit einem Absatz, dessen Text die angegebenen Formate trägt (Schlüssel wie in Yjs). */
function formatted(attributes: Record<string, unknown>): Y.Doc {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  const text = new Y.XmlText();
  text.insert(0, 'abc', attributes);
  paragraph.insert(0, [text]);
  doc.getXmlFragment(FIELD).insert(0, [paragraph]);
  return doc;
}

/** Ein Dokument mit einer Tabelle aus einer Zelle mit dem angegebenen Attribut. */
function cellWith(name: string, value: unknown): Y.Doc {
  const doc = new Y.Doc();
  const table = new Y.XmlElement('table');
  const row = new Y.XmlElement('tableRow');
  const cell = new Y.XmlElement('tableCell');
  cell.setAttribute(name, value as never);
  cell.insert(0, [new Y.XmlElement('paragraph')]);
  row.insert(0, [cell]);
  table.insert(0, [row]);
  doc.getXmlFragment(FIELD).insert(0, [table]);
  return doc;
}

/** Löscht y-tiptap beim Binden etwas aus diesem Dokument? */
function bindingDeletes(doc: Y.Doc): boolean {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  const before = copy.getXmlFragment(FIELD).toString();
  initProseMirrorDoc(copy.getXmlFragment(FIELD), schema);
  return copy.getXmlFragment(FIELD).toString() !== before;
}

describe('markName', () => {
  it('erkennt den Hash, den y-tiptap bei sich überlappenden Markierungen anhängt, und genau diesen', () => {
    expect(markName('bold')).toBe('bold');
    expect(markName('link--AbCd1234')).toBe('link');
    expect(markName('link--a+/=1234')).toBe('link');
    expect(markName('bold--zz')).toBe('bold--zz'); // kein Hash: y-tiptap behandelt es als eigenen (unbekannten) Namen
    expect(markName('bold--')).toBe('bold--');
    expect(markName('a--b--AbCd1234')).toBe('a--b');
  });
});

describe('docProblem: was y-tiptap beim Binden löschen würde', () => {
  const cases: [string, () => Y.Doc][] = [
    ['eine Markierung mit angehängtem, aber kurzem „Hash“', () => formatted({ 'bold--zz': {} })],
    ['ein ausdrücklich leeres (null) Attribut, das das Schema nicht zulässt', () => cellWith('colspan', null)],
    ['ein Format mit dem Wert false und unbekanntem Namen', () => formatted({ sparkle: false })],
  ];
  for (const [what, make] of cases) {
    it(`lehnt ab: ${what}`, () => {
      const doc = make();
      expect(bindingDeletes(doc), 'y-tiptap löscht hier tatsächlich').toBe(true);
      expect(docProblem(doc)).not.toBeNull();
    });
  }

  it('lässt ein gewöhnliches Dokument mit Markierungen, Tabelle und leerem Absatz durch', () => {
    const doc = formatted({ bold: {}, italic: {} });
    doc.getXmlFragment(FIELD).insert(1, [new Y.XmlElement('paragraph')]);
    expect(bindingDeletes(doc)).toBe(false);
    expect(docProblem(doc)).toBeNull();
    expect(docProblem(cellWith('colspan', 2))).toBeNull();
  });
});
