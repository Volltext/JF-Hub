import { getSchema } from '@tiptap/core';
import { Fragment, Mark, type Node as PMNode, type NodeType } from '@tiptap/pm/model';
import { Transform, canSplit, findWrapping, liftTarget } from '@tiptap/pm/transform';
import { initProseMirrorDoc, updateYFragment } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { FIELD, jsonToYDoc } from '../../../../../server/src/collab/convert';
import { EXTENSIONS } from '../editorSchema';
import { repairDoc } from './repair';
import { docProblem, yDocToJson } from './yJson';

/**
 * Zufallstest für die Reparatur: Zwei Geräte bearbeiten dieselbe Basis gleichzeitig mit echten Editor-Schritten (Löschen, Tippen, Teilen,
 * Verschachteln, Anheben, Verbinden …); jede Bearbeitung für sich ergibt ein gültiges Dokument. Beim Zusammenführen kann ein Dokument
 * entstehen, das gegen die Inhaltsregeln verstößt (leere Liste, Listenpunkt mit Überschrift vorn). Die Reparatur muss daraus immer ein Dokument
 * machen, das der Editor ohne Verlust bindet, und darf dabei nur leere Teile ergänzen (der Text bleibt Wort für Wort gleich).
 * Die Zahlen sind fest (kein Zufall von Lauf zu Lauf), die Fälle deterministisch.
 */
const schema = getSchema(EXTENSIONS);

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { p: (x: number) => next() < x, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]! };
}
type Rnd = ReturnType<typeof rng>;

const WORDS = ['Alarm', 'Übung', 'Atemschutz', 'Knoten', 'Löschangriff', 'Spiel', 'Wetter', 'Protokoll'];
/** Markierungen ohne Attribute; Code schließt alle anderen aus, deshalb entstehen beim gleichzeitigen Formatieren ungültige Mischungen. */
const INLINE_MARKS = [schema.marks.bold!, schema.marks.italic!, schema.marks.underline!, schema.marks.code!];

function text(r: Rnd, type: NodeType): PMNode[] {
  return Array.from({ length: r.int(1, 3) }, () => schema.text(`${r.pick(WORDS)} `, type.spec.marks === '' ? Mark.none : r.p(0.3) ? [r.pick(INLINE_MARKS)!.create()] : Mark.none));
}

function block(r: Rnd, type: NodeType, depth: number): PMNode {
  const attrs: Record<string, unknown> = type.name === 'heading' ? { level: r.int(1, 3) } : type.name === 'taskItem' ? { checked: false } : {};
  if (type.isTextblock) return type.create(attrs, text(r, type));
  if (type.isLeaf) return type.create(attrs);
  const kids: PMNode[] = [];
  let match = type.contentMatch;
  const target = r.int(1, depth > 1 ? 2 : 3);
  for (let guard = 0; guard < 30; guard++) {
    if (kids.length >= target && match.validEnd) break;
    const opts = [];
    for (let i = 0; i < match.edgeCount; i++) {
      const e = match.edge(i);
      if (e.type.isText || ['ink', 'photo', 'attachment', 'horizontalRule', 'codeBlock'].includes(e.type.name)) continue;
      if (depth >= 3 && !e.type.isTextblock) continue;
      opts.push(e);
    }
    if (!opts.length || kids.length >= target) {
      const fill = match.fillBefore(Fragment.empty, true);
      if (fill) fill.forEach((n) => kids.push(n));
      break;
    }
    const e = r.pick(opts);
    kids.push(block(r, e.type, depth + 1));
    match = e.next;
  }
  return type.create(attrs, kids);
}

function randomDoc(seed: number): PMNode {
  const r = rng(seed);
  const top = schema.topNodeType;
  const kids: PMNode[] = [];
  let match = top.contentMatch;
  const n = r.int(2, 6);
  for (let i = 0; i < n; i++) {
    const opts = [];
    for (let k = 0; k < match.edgeCount; k++) {
      const t = match.edge(k).type;
      if (!t.isText && !['ink', 'photo', 'attachment', 'horizontalRule', 'codeBlock'].includes(t.name)) opts.push(match.edge(k));
    }
    const e = r.pick(opts);
    kids.push(block(r, e.type, 1));
    match = e.next;
  }
  return top.create(null, kids);
}

/** Eine zufällige Bearbeitung, wie der Editor sie macht; Ergebnis nur, wenn es gültig bleibt. */
function edit(r: Rnd, doc: PMNode): { doc: PMNode; what: string } | null {
  const tr = new Transform(doc);
  const nodes: { node: PMNode; pos: number }[] = [];
  doc.descendants((node, pos) => {
    nodes.push({ node, pos });
  });
  const blocks = nodes.filter((n) => n.node.isBlock);
  const textblocks = nodes.filter((n) => n.node.isTextblock);
  const kind = r.pick(['delete', 'delete', 'text', 'text', 'split', 'wrap', 'lift', 'join', 'level', 'mark', 'mark', 'mark', 'newpara'] as const);
  try {
    switch (kind) {
      case 'delete': {
        const b = r.pick(blocks);
        tr.delete(b.pos, b.pos + b.node.nodeSize);
        break;
      }
      case 'text': {
        const b = r.pick(textblocks);
        tr.insert(b.pos + 1 + r.int(0, b.node.content.size), schema.text('neu '));
        break;
      }
      case 'split': {
        const b = r.pick(textblocks);
        const pos = b.pos + 1 + r.int(0, b.node.content.size);
        if (!canSplit(tr.doc, pos)) return null;
        tr.split(pos);
        break;
      }
      case 'wrap': {
        const b = r.pick(blocks);
        const $from = doc.resolve(b.pos);
        const range = $from.blockRange(doc.resolve(b.pos + b.node.nodeSize));
        if (!range) return null;
        const w = findWrapping(range, r.pick([schema.nodes.bulletList!, schema.nodes.blockquote!, schema.nodes.orderedList!]));
        if (!w) return null;
        tr.wrap(range, w);
        break;
      }
      case 'lift': {
        const b = r.pick(textblocks);
        const $from = doc.resolve(b.pos + 1);
        const range = $from.blockRange();
        if (!range) return null;
        const target = liftTarget(range);
        if (target == null) return null;
        tr.lift(range, target);
        break;
      }
      case 'join': {
        const b = r.pick(blocks);
        const pos = b.pos + b.node.nodeSize;
        if (pos >= doc.content.size || !tr.doc.resolve(pos).nodeBefore || !tr.doc.resolve(pos).nodeAfter) return null;
        tr.join(pos);
        break;
      }
      case 'level': {
        const b = r.pick(textblocks);
        tr.setNodeMarkup(b.pos, b.node.type === schema.nodes.heading ? schema.nodes.paragraph : schema.nodes.heading, b.node.type === schema.nodes.heading ? null : { level: 2 });
        break;
      }
      case 'mark': {
        const b = r.pick(textblocks);
        if (b.node.content.size < 2) return null;
        const from = b.pos + 1 + r.int(0, b.node.content.size - 2);
        tr.addMark(from, Math.min(from + r.int(2, 5), b.pos + 1 + b.node.content.size), r.pick(INLINE_MARKS).create());
        break;
      }
      case 'newpara': {
        const b = r.pick(blocks);
        tr.insert(b.pos + b.node.nodeSize, schema.nodes.paragraph!.create(null, schema.text('Einschub')));
        break;
      }
    }
    tr.doc.check();
  } catch {
    return null;
  }
  if (!tr.docChanged || tr.doc.childCount === 0) return null;
  return { doc: tr.doc, what: kind };
}

/** Ein Gerät mit Kopie des Basiszustands bearbeitet; liefert sein Update seit der Basis. */
function device(baseBytes: Uint8Array, r: Rnd): { ydoc: Y.Doc; sv: Uint8Array; ops: string[] } {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, baseBytes);
  const sv = Y.encodeStateVector(ydoc);
  const ops: string[] = [];
  for (let i = 0; i < r.int(1, 3); i++) {
    const frag = ydoc.getXmlFragment(FIELD);
    const { doc, meta } = initProseMirrorDoc(frag, schema);
    const next = edit(r, doc);
    if (!next) continue;
    ops.push(next.what);
    updateYFragment(ydoc, frag, next.doc, meta);
  }
  return { ydoc, sv, ops };
}

/** Der Text je Textblock (ohne die Grenzen zwischen gleich oder verschieden formatierten Stücken: Formate zu entfernen verschmilzt Stücke). */
const allText = (json: unknown): string[] => {
  const n = json as { type?: string; text?: string; content?: { type?: string; text?: string }[] };
  if (n.content?.some((c) => c.type === 'text')) return [n.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')];
  return ((n.content ?? []) as unknown[]).flatMap(allText);
};

describe('Reparatur nach gleichzeitigen Strukturänderungen (echte Editor-Schritte)', () => {
  it('jedes Zusammenführen ergibt ein bindbares Dokument, und der Text bleibt, wie er war', () => {
    let pairs = 0;
    let broken = 0;
    let repaired = 0;
    for (let seed = 1; seed <= 700; seed++) {
      const r = rng(seed * 7919);
      const base = randomDoc(seed);
      try {
        base.check();
      } catch {
        continue;
      }
      const baseBytes = Y.encodeStateAsUpdate(jsonToYDoc(base.toJSON()));
      const a = device(baseBytes, r);
      const b = device(baseBytes, r);
      if (!a.ops.length || !b.ops.length) continue;
      pairs++;
      const merged = new Y.Doc();
      Y.applyUpdate(merged, baseBytes);
      Y.applyUpdate(merged, Y.encodeStateAsUpdate(a.ydoc, a.sv));
      Y.applyUpdate(merged, Y.encodeStateAsUpdate(b.ydoc, b.sv));
      const textBefore = allText(yDocToJson(merged)).join('\u0000');
      if (!docProblem(merged)) {
        expect(repairDoc(merged), `seed ${seed}: ein gültiges Dokument wird nicht angefasst`).toBe(false);
        continue;
      }
      broken++;
      const ok = repairDoc(merged);
      const problem = docProblem(merged);
      expect(problem, `seed ${seed} (A=${a.ops.join('+')}, B=${b.ops.join('+')}): ${problem}`).toBeNull();
      expect(ok).toBe(true);
      repaired++;
      expect(allText(yDocToJson(merged)).join('\u0000'), `seed ${seed}: Text unverändert`).toBe(textBefore);
      // der Editor löscht beim Binden nichts mehr
      const before = merged.getXmlFragment(FIELD).toString();
      initProseMirrorDoc(merged.getXmlFragment(FIELD), schema);
      expect(merged.getXmlFragment(FIELD).toString(), `seed ${seed}: Binden verändert das Dokument`).toBe(before);
    }
    expect(pairs).toBeGreaterThan(150);
    expect(broken).toBeGreaterThan(0); // der Test findet die Fälle, für die es die Reparatur gibt
    expect(repaired).toBe(broken);
  }, 120_000);
});

describe('Reparatur nach gleichzeitigem Formatieren derselben Stelle', () => {
  const plain = Object.values(schema.marks).filter((m) => m.name !== 'link'); // ohne Pflichtattribut
  const base = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Löschangriff mit Atemschutz' }] }] };

  it('jede Mischung zweier Markierungen wird repariert, der Text bleibt, Code gewinnt', () => {
    const baseBytes = Y.encodeStateAsUpdate(jsonToYDoc(base as never));
    const size = 'Löschangriff mit Atemschutz'.length;
    let conflicts = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed * 104729);
      const range = () => {
        const from = r.int(1, size - 2);
        return [from, Math.min(size + 1, from + r.int(2, 9))] as const;
      };
      const [af, at] = range();
      const [bf, bt] = range();
      const ma = r.pick(plain);
      const mb = r.pick(plain);
      const run = (from: number, to: number, m: (typeof plain)[number]) => {
        const d = new Y.Doc();
        Y.applyUpdate(d, baseBytes);
        const sv = Y.encodeStateVector(d);
        const frag = d.getXmlFragment(FIELD);
        const { doc: pm, meta } = initProseMirrorDoc(frag, schema);
        const tr = new Transform(pm);
        tr.addMark(from, to, m.create());
        updateYFragment(d, frag, tr.doc, meta);
        return Y.encodeStateAsUpdate(d, sv);
      };
      const merged = new Y.Doc();
      Y.applyUpdate(merged, baseBytes);
      Y.applyUpdate(merged, run(af, at, ma));
      Y.applyUpdate(merged, run(bf, bt, mb));
      const label = `seed ${seed}: ${ma.name} [${af},${at}] + ${mb.name} [${bf},${bt}]`;
      if (!docProblem(merged)) {
        expect(repairDoc(merged), `${label}: ein gültiges Dokument wird nicht angefasst`).toBe(false);
        continue;
      }
      conflicts++;
      expect(repairDoc(merged), label).toBe(true);
      expect(docProblem(merged), label).toBeNull();
      expect(allText(yDocToJson(merged)).join(''), `${label}: Text unverändert`).toBe('Löschangriff mit Atemschutz');
      // wo Code ist, ist nichts sonst
      const json = yDocToJson(merged);
      const bad = (json.content ?? []).flatMap((blk) => blk.content ?? []).filter((t) => (t.marks ?? []).some((m) => m.type === 'code') && (t.marks ?? []).length > 1);
      expect(bad, label).toEqual([]);
      const before = merged.getXmlFragment(FIELD).toString();
      initProseMirrorDoc(merged.getXmlFragment(FIELD), schema);
      expect(merged.getXmlFragment(FIELD).toString(), `${label}: Binden verändert das Dokument`).toBe(before);
    }
    expect(conflicts).toBeGreaterThan(20); // der Test trifft die Fälle, für die es die Reparatur gibt
  });
});
