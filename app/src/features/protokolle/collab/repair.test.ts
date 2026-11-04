import { getSchema, type JSONContent } from '@tiptap/core';
import { Transform } from '@tiptap/pm/transform';
import { initProseMirrorDoc, updateYFragment } from '@tiptap/y-tiptap';
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

/** Eine Bearbeitung wie im Editor: ProseMirror-Schritt auf dem gebundenen Dokument, danach `updateYFragment`. */
function edit(ydoc: Y.Doc, fn: (tr: Transform) => void): void {
  const frag = ydoc.getXmlFragment(FIELD);
  const { doc: pm, meta } = initProseMirrorDoc(frag, schema);
  const tr = new Transform(pm);
  fn(tr);
  updateYFragment(ydoc, frag, tr.doc, meta);
}
const clone = (bytes: Uint8Array): Y.Doc => {
  const d = new Y.Doc();
  Y.applyUpdate(d, bytes);
  return d;
};
/** Zwei Geräte bearbeiten dieselbe Basis gleichzeitig; Ergebnis: der zusammengeführte Zustand und die Zustände der beiden Geräte. */
function concurrently(base: JSONContent, a: (tr: Transform) => void, b: (tr: Transform) => void) {
  const bytes = Y.encodeStateAsUpdate(jsonToYDoc(base));
  const da = clone(bytes);
  const db = clone(bytes);
  const svA = Y.encodeStateVector(da);
  const svB = Y.encodeStateVector(db);
  edit(da, a);
  edit(db, b);
  const merged = clone(bytes);
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(da, svA));
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(db, svB));
  return { merged, bytes, da, db, svA, svB };
}
const marksOfText = (json: JSONContent, word: string): string[] => {
  const found: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'text' && n.text?.includes(word)) found.push((n.marks ?? []).map((m) => m.type).sort().join('+'));
    (n.content ?? []).forEach(walk);
  };
  walk(json);
  return found;
};

describe('repairDoc: Markierungen, die sich ausschließen', () => {
  const hallo = doc(p('Hallo Welt'));
  const bold = () => schema.marks.bold!.create();
  const code = () => schema.marks.code!.create();

  it('fett (Gerät A) und Code (Gerät B) gleichzeitig auf demselben Wort: Das Ergebnis ist ungültig, die Reparatur lässt Code stehen', () => {
    const { merged } = concurrently(hallo, (tr) => tr.addMark(7, 11, bold()), (tr) => tr.addMark(7, 11, code()));
    expect(docProblem(merged)).toMatch(/marks/); // Code schließt alle anderen Markierungen aus
    expect(repairDoc(merged)).toBe(true);
    expect(docProblem(merged)).toBeNull();
    expect(marksOfText(yDocToJson(merged), 'Welt')).toEqual(['code']);
    expect(textOf(yDocToJson(merged))).toBe('Hallo |Welt'); // der Text bleibt, wie er ist
  });

  it('überlappen sich die Bereiche nur teilweise, wird nur die Überschneidung bereinigt', () => {
    const { merged } = concurrently(hallo, (tr) => tr.addMark(1, 8, bold()), (tr) => tr.addMark(6, 11, code())); // fett „Hallo W“, Code „o Welt“
    expect(repairDoc(merged)).toBe(true);
    expect(docProblem(merged)).toBeNull();
    const json = yDocToJson(merged);
    expect(marksOfText(json, 'Hall')).toEqual(['bold']); // außerhalb der Überschneidung bleibt fett
    expect(marksOfText(json, 'lt')).toEqual(['code']);
    expect(texts(json).join('')).toBe('Hallo Welt');
  });

  it('andere Markierungen vertragen sich und bleiben unberührt', () => {
    const { merged } = concurrently(hallo, (tr) => tr.addMark(1, 6, bold()), (tr) => tr.addMark(1, 6, schema.marks.italic!.create()));
    expect(docProblem(merged)).toBeNull();
    let updates = 0;
    merged.on('update', () => updates++);
    expect(repairDoc(merged)).toBe(false);
    expect(updates).toBe(0);
    expect(marksOfText(yDocToJson(merged), 'Hallo')).toEqual(['bold+italic']);
  });

  it('beide Geräte reparieren für sich: Nach dem Zusammenführen ist das Ergebnis gültig und gleich (die Reparatur ist wiederholbar)', () => {
    const { merged, da, db, svA, svB } = concurrently(hallo, (tr) => tr.addMark(7, 11, bold()), (tr) => tr.addMark(7, 11, code()));
    // jedes Gerät sieht den Zustand des anderen und repariert, bevor es das Ergebnis des anderen kennt
    const a = clone(Y.encodeStateAsUpdate(merged));
    const b = clone(Y.encodeStateAsUpdate(merged));
    void da;
    void db;
    void svA;
    void svB;
    const beforeA = Y.encodeStateVector(a);
    const beforeB = Y.encodeStateVector(b);
    expect(repairDoc(a)).toBe(true);
    expect(repairDoc(b)).toBe(true);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, beforeA));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, beforeB));
    for (const d of [a, b]) {
      expect(docProblem(d)).toBeNull();
      expect(marksOfText(yDocToJson(d), 'Welt')).toEqual(['code']);
    }
    expect(yDocToJson(a)).toEqual(yDocToJson(b));
    expect(repairDoc(a)).toBe(false); // ein zweiter Lauf findet nichts mehr
  });

  it('nach der Reparatur bindet der Editor, ohne etwas aus dem geteilten Dokument zu löschen', () => {
    const { merged } = concurrently(hallo, (tr) => tr.addMark(7, 11, bold()), (tr) => tr.addMark(7, 11, code()));
    repairDoc(merged);
    const before = merged.getXmlFragment(FIELD).toString();
    const { doc: pm } = initProseMirrorDoc(merged.getXmlFragment(FIELD), schema);
    expect(merged.getXmlFragment(FIELD).toString()).toBe(before);
    expect(pm.textContent).toBe('Hallo Welt');
  });
});
