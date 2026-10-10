import { Fragment, type Node as PMNode, type NodeType } from '@tiptap/pm/model';
import * as Y from 'yjs';
import { appSchema } from '../editorSchema';
import { FIELD, markName } from './yJson';

/**
 * Repariert ein Yjs-Dokument, das gegen die Inhaltsregeln des Schemas verstößt, ohne etwas zu löschen.
 *
 * Gleichzeitige Strukturänderungen können so etwas ergeben, obwohl jede für sich zulässig war: Streicht eine Person den einen und eine
 * andere den anderen von zwei Listenpunkten, ist die Liste leer; löscht eine den Absatz am Anfang eines Listenpunkts, während eine
 * andere dort eine Überschrift einfügt, beginnt der Punkt mit der Überschrift. `@tiptap/y-tiptap` löscht ein Element, das es nicht bauen
 * kann, beim Binden aus dem *geteilten* Dokument, samt Inhalt und für alle. Ohne Reparatur bliebe nur, das Protokoll für alle zu sperren.
 *
 * Die Reparatur ergänzt, was die Regeln verlangen (ein leerer Absatz, ein leerer Listenpunkt, eine leere Zelle), und löscht nie Text.
 * Dasselbe gilt für Markierungen, die sich ausschließen: Formatieren zwei Personen dasselbe Wort gleichzeitig, die eine fett, die andere als
 * Code, trägt es beides, und das Schema erlaubt es nicht (Code schließt alle anderen Markierungen aus). Es bleibt, was auch der Editor beim
 * Anwenden einer zweiten Markierung behielte (`Mark.addToSet`: Code gewinnt); die übrigen werden vom Text genommen.
 * Was sich so nicht reparieren lässt (ein Element an einer Stelle, wo es nie stehen darf, ein unbekanntes Element), bleibt unverändert; dann
 * bleibt es bei der Sperre. Sie läuft in einer Transaktion des Aufrufers oder in einer eigenen und ist ein gewöhnliches Update, das an die
 * anderen Geräte geht. Wiederholen findet nichts mehr. Liefert true, wenn etwas ergänzt wurde.
 */
export function repairDoc(doc: Y.Doc): boolean {
  const schema = appSchema();
  let changed = false;
  doc.transact(() => {
    changed = repairContainer(doc.getXmlFragment(FIELD), schema.topNodeType, true);
    changed = repairMarks(doc.getXmlFragment(FIELD)) || changed;
  });
  return changed;
}

/**
 * Welche der Formate eines Textstücks (Schlüssel wie in Yjs) müssen weg, weil sie sich nach dem Schema ausschließen? Dieselbe Rechnung wie
 * `Mark.addToSet` in der Reihenfolge der Schema-Rangfolge, damit jedes Gerät zum selben Ergebnis kommt.
 */
function excludedFormats(keys: string[]): string[] {
  const schema = appSchema();
  const rank = (name: string): number => Object.keys(schema.marks).indexOf(name); // die Reihenfolge im Schema ist die Rangfolge von ProseMirror
  const entries = keys
    .map((key) => ({ key, type: schema.marks[markName(key)] }))
    .filter((e): e is { key: string; type: NonNullable<typeof e.type> } => !!e.type) // Unbekanntes ist nicht unsere Sache
    .sort((x, y) => rank(x.type.name) - rank(y.type.name) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const kept: typeof entries = [];
  const drop: string[] = [];
  for (const e of entries) {
    if (kept.some((k) => k.type.excludes(e.type))) {
      drop.push(e.key);
      continue;
    }
    for (let i = kept.length - 1; i >= 0; i--) {
      if (e.type.excludes(kept[i]!.type)) drop.push(...kept.splice(i, 1).map((k) => k.key));
    }
    kept.push(e);
  }
  return drop;
}

/** Nimmt ausgeschlossene Markierungen von jedem Textstück. Ändert keinen Text. */
function repairMarks(fragment: Y.XmlFragment): boolean {
  let changed = false;
  const visit = (parent: Container): void => {
    for (const child of parent.toArray()) {
      if (child instanceof Y.XmlText) {
        let at = 0;
        for (const op of child.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
          const length = typeof op.insert === 'string' ? op.insert.length : 1;
          const drop = op.attributes ? excludedFormats(Object.keys(op.attributes)) : [];
          if (drop.length) {
            child.format(at, length, Object.fromEntries(drop.map((key) => [key, null])));
            changed = true;
          }
          at += length;
        }
      } else if (isElement(child)) {
        visit(child);
      }
    }
  };
  visit(fragment);
  return changed;
}

type Container = Y.XmlFragment | Y.XmlElement;

const isElement = (n: unknown): n is Y.XmlElement => n instanceof Y.XmlElement;

/** Ein Platzhalter-Knoten des Typs, an dem ProseMirror die Inhaltsregel prüft (es zählt nur der Typ). */
function placeholder(type: NodeType): PMNode {
  const schema = appSchema();
  return type.isText ? schema.text('x') : type.create();
}

/** Ein ergänzter Knoten als Yjs-Element mit den Vorgaben des Schemas, so wie y-tiptap es schreibt (Attribute ohne Wert fehlen). */
function toYElement(node: PMNode): Y.XmlElement | null {
  if (node.isText) return null; // ergänzt wird nie Text
  const el = new Y.XmlElement(node.type.name);
  for (const [key, value] of Object.entries(node.attrs)) {
    if (value !== null && value !== undefined) el.setAttribute(key, value as never);
  }
  const children: Y.XmlElement[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = toYElement(node.child(i));
    if (!child) return null;
    children.push(child);
  }
  if (children.length) el.insert(0, children);
  return el;
}

function insertFiller(parent: Container, index: number, filler: Fragment): boolean {
  const els: Y.XmlElement[] = [];
  for (let i = 0; i < filler.childCount; i++) {
    const el = toYElement(filler.child(i));
    if (!el) return false;
    els.push(el);
  }
  parent.insert(index, els);
  return true;
}

/** Prüft die Kinder dieses Elements gegen die Inhaltsregel seines Typs (zuerst die Kinder selbst, von unten nach oben). */
function repairContainer(parent: Container, type: NodeType, isRoot = false): boolean {
  const schema = appSchema();
  let changed = false;
  for (const child of parent.toArray()) {
    if (!isElement(child)) continue;
    const childType = schema.nodes[child.nodeName];
    if (childType) changed = repairContainer(child, childType) || changed;
  }

  const kids = parent.toArray();
  if (isRoot && kids.length === 0) return changed; // ein leeres Dokument ist gültig: der erste Absatz entsteht beim Tippen
  const types: NodeType[] = [];
  for (const kid of kids) {
    const t = isElement(kid) ? schema.nodes[kid.nodeName] : schema.nodes.text;
    if (!t) return changed; // unbekanntes Element: nicht unsere Sache
    types.push(t);
  }

  let match = type.contentMatch;
  let at = 0; // Stelle in `parent`, an der das nächste Kind steht
  for (const t of types) {
    let next = match.matchType(t);
    if (!next) {
      // Fehlt vor diesem Kind etwas? Wenn sich die Regel durch Einfügen davor erfüllen lässt, wird eingefügt, sonst bleibt es, wie es ist.
      const filler = match.fillBefore(Fragment.from(placeholder(t)), false);
      if (!filler || filler.childCount === 0) return changed;
      const filled = match.matchFragment(filler);
      next = filled?.matchType(t) ?? null;
      if (!filled || !next) return changed;
      if (!insertFiller(parent, at, filler)) return changed;
      at += filler.childCount;
      changed = true;
    }
    match = next;
    at++;
  }
  if (!match.validEnd) {
    const filler = match.fillBefore(Fragment.empty, true);
    if (!filler || filler.childCount === 0) return changed;
    if (!insertFiller(parent, at, filler)) return changed;
    changed = true;
  }
  return changed;
}
