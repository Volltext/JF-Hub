import { getSchema, type JSONContent } from '@tiptap/core';
import { initProseMirrorDoc } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { FIELD, jsonToYDoc } from '../../../../../server/src/collab/convert';
import { demoData } from '../../../../../server/src/demoData';
import { EXTENSIONS } from '../editorSchema';
import { repairDoc } from './repair';
import { docProblem, yDocToJson } from './yJson';

/**
 * Gleichzeitige Strukturänderungen können ein Dokument ergeben, das jede Änderung für sich zulässt, zusammen aber gegen die Inhaltsregeln
 * verstößt (zwei streichen je einen von zwei Listenpunkten: die Liste ist leer). `@tiptap/y-tiptap` würde das Element beim Binden löschen,
 * samt Inhalt und für alle; ohne Reparatur bliebe das Protokoll für alle gesperrt. Die Reparatur ergänzt leere Teile und löscht nichts.
 */
const schema = getSchema(EXTENSIONS);
const t = (text: string): JSONContent => ({ type: 'text', text });
const p = (text?: string): JSONContent => (text ? { type: 'paragraph', content: [t(text)] } : { type: 'paragraph' });
const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const ydocOf = (json: JSONContent): Y.Doc => {
  const d = new Y.Doc();
  Y.applyUpdate(d, Y.encodeStateAsUpdate(jsonToYDoc(json)));
  return d;
};
/** Text aller Textknoten in Dokumentreihenfolge, mit | getrennt. */
const texts = (json: JSONContent): string[] => (json.type === 'text' ? [json.text ?? ''] : (json.content ?? []).flatMap(texts));
const textOf = (json: JSONContent): string => texts(json).join('|');

describe('repairDoc: ergänzt, was die Inhaltsregeln verlangen, und löscht nichts', () => {
  it('eine Liste ohne Punkte bekommt einen leeren Punkt', () => {
    const d = ydocOf(doc(p('davor'), { type: 'bulletList' }, p('danach')));
    expect(docProblem(d)).not.toBeNull();
    expect(repairDoc(d)).toBe(true);
    expect(docProblem(d)).toBeNull();
    expect(yDocToJson(d)).toEqual(doc(p('davor'), { type: 'bulletList', content: [li(p())] }, p('danach')));
  });

  it('auch nummerierte Listen, Aufgabenlisten und Zitate ohne Inhalt', () => {
    const d = ydocOf(doc({ type: 'orderedList' }, { type: 'taskList' }, { type: 'blockquote' }));
    expect(repairDoc(d)).toBe(true);
    expect(docProblem(d)).toBeNull();
    const out = yDocToJson(d).content!;
    expect(out.map((n) => n.type)).toEqual(['orderedList', 'taskList', 'blockquote']);
    expect(out[0]!.content![0]!.type).toBe('listItem');
    expect(out[1]!.content![0]!.type).toBe('taskItem');
    expect(out[2]!.content![0]!.type).toBe('paragraph');
  });

  it('ein Listenpunkt, der nicht mit einem Absatz beginnt, bekommt vorn einen leeren Absatz; der Inhalt bleibt', () => {
    const d = ydocOf(doc({ type: 'bulletList', content: [li({ type: 'heading', attrs: { level: 2 }, content: [t('Titel')] }, p('Text'))] }));
    expect(docProblem(d)).not.toBeNull();
    expect(repairDoc(d)).toBe(true);
    expect(docProblem(d)).toBeNull();
    const item = yDocToJson(d).content![0]!.content![0]!;
    expect(item.content!.map((n) => n.type)).toEqual(['paragraph', 'heading', 'paragraph']);
    expect(textOf(yDocToJson(d))).toBe('Titel|Text');
  });

  it('dasselbe für einen Aufgabenpunkt', () => {
    const d = ydocOf(doc({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'heading', attrs: { level: 1 }, content: [t('Wichtig')] }] }] }));
    expect(repairDoc(d)).toBe(true);
    expect(docProblem(d)).toBeNull();
    expect(textOf(yDocToJson(d))).toBe('Wichtig');
  });

  it('eine Tabelle ohne Zeilen, eine Zeile ohne Zellen', () => {
    const d = ydocOf(doc({ type: 'table' }, { type: 'table', content: [{ type: 'tableRow' }] }));
    expect(repairDoc(d)).toBe(true);
    expect(docProblem(d)).toBeNull();
  });

  it('von unten nach oben: eine leere Liste in einem Listenpunkt, der selbst nur diese Liste enthält', () => {
    const d = ydocOf(doc({ type: 'bulletList', content: [li(p('Punkt'), { type: 'orderedList' })] }));
    expect(repairDoc(d)).toBe(true);
    expect(docProblem(d)).toBeNull();
    expect(textOf(yDocToJson(d))).toBe('Punkt');
  });

  it('mehrere Stellen auf einmal; ein zweiter Lauf findet nichts mehr', () => {
    const d = ydocOf(doc({ type: 'bulletList' }, p('mitten'), { type: 'bulletList', content: [li({ type: 'heading', attrs: { level: 3 }, content: [t('H')] })] }));
    expect(repairDoc(d)).toBe(true);
    expect(docProblem(d)).toBeNull();
    let updates = 0;
    d.on('update', () => updates++);
    expect(repairDoc(d)).toBe(false);
    expect(updates).toBe(0);
  });

  it('ein gültiges Dokument bleibt unberührt: kein Update, auch nicht für ein leeres Dokument', () => {
    for (const json of [doc(), doc(p()), doc(p('Text'), { type: 'bulletList', content: [li(p('a'))] })]) {
      const d = ydocOf(json);
      let updates = 0;
      d.on('update', () => updates++);
      expect(repairDoc(d)).toBe(false);
      expect(updates).toBe(0);
    }
  });

  it('was sich durch Ergänzen nicht reparieren lässt, bleibt unverändert und gesperrt', () => {
    // ein Absatz direkt in einer Liste: dort ist nichts außer Listenpunkten erlaubt
    const d = ydocOf(doc({ type: 'bulletList', content: [li(p('a')), p('lose')] }));
    const before = d.getXmlFragment(FIELD).toString();
    expect(repairDoc(d)).toBe(false);
    expect(d.getXmlFragment(FIELD).toString()).toBe(before);
    expect(docProblem(d)).not.toBeNull();
  });

  it('unbekannte Elemente fasst die Reparatur nicht an', () => {
    const d = ydocOf(doc({ type: 'callout', content: [p('fremd')] }, { type: 'bulletList' }));
    const problemBefore = docProblem(d);
    expect(problemBefore).toContain('callout');
    repairDoc(d);
    expect(docProblem(d)).toContain('callout'); // gesperrt bleibt gesperrt
    expect(textOf(yDocToJson(d))).toBe('fremd');
  });

  it('nach der Reparatur löscht der Editor beim Binden nichts mehr aus dem geteilten Dokument', () => {
    const d = ydocOf(doc(p('davor'), { type: 'bulletList', content: [li({ type: 'heading', attrs: { level: 2 }, content: [t('H')] })] }, { type: 'orderedList' }));
    // ohne Reparatur würde y-tiptap die Elemente beim Binden löschen …
    const lossy = ydocOf(yDocToJson(d));
    initProseMirrorDoc(lossy.getXmlFragment(FIELD), schema);
    expect(textOf(yDocToJson(lossy))).not.toContain('H');
    // … nach der Reparatur bleibt alles
    expect(repairDoc(d)).toBe(true);
    const before = d.getXmlFragment(FIELD).toString();
    const { doc: pm } = initProseMirrorDoc(d.getXmlFragment(FIELD), schema);
    expect(d.getXmlFragment(FIELD).toString()).toBe(before);
    expect(textOf(pm.toJSON() as JSONContent)).toBe('davor|H');
  });

  it('die Beispieldaten der Demo bleiben unberührt', () => {
    const demo = demoData(new Date('2026-10-09T12:00:00Z'), { jana: 'jana', tobias: 'tobias' });
    for (const proto of demo.protocols) {
      const d = ydocOf(proto.content as JSONContent);
      let updates = 0;
      d.on('update', () => updates++);
      expect(repairDoc(d)).toBe(false);
      expect(updates).toBe(0);
    }
  });

  it('die Reparatur ist ein gewöhnliches Update: Sie lässt sich weitergeben, und andere Geräte sehen dasselbe', () => {
    const a = ydocOf(doc(p('x'), { type: 'bulletList' }));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const sv = Y.encodeStateVector(a);
    expect(repairDoc(a)).toBe(true);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, sv));
    expect(yDocToJson(b)).toEqual(yDocToJson(a));
    expect(docProblem(b)).toBeNull();
  });
});
