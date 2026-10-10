import * as Y from 'yjs';

/**
 * Umwandlung zwischen dem ProseMirror-JSON eines Protokolls und dem Yjs-Dokument, in dem der Text zusammen bearbeitet wird.
 *
 * Der Server kennt das Editor-Schema nicht (siehe Leitentscheidung 5): Er legt die Struktur so an, wie `@tiptap/y-tiptap` sie aus einem
 * ProseMirror-Dokument erzeugt, und liest sie wieder aus. Ob beides übereinstimmt, prüft ein Golden-Test in `app/` gegen y-tiptap.
 * Wichtig ist die *kanonische* Form: Wer ein Protokoll öffnet, soll dabei nichts ins geteilte Dokument schreiben. y-tiptap vergleicht
 * dafür Attribute (ohne `null`, mit den Vorgaben des Schemas) und fasst benachbarte Texte in einem `Y.XmlText` zusammen.
 */

/** Name des `Y.XmlFragment` im Dokument. Muss mit `field` des Editors in der App übereinstimmen. */
export const FIELD = 'body';

export class ConvertError extends Error {}

export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: DocMark[];
  text?: string;
}

/**
 * Vorgaben des Editor-Schemas, die nicht `null` sind. y-tiptap schreibt sie in jedes Element; fehlen sie im JSON (von Hand erzeugte
 * Inhalte), ergänzt der Konverter sie, damit das Öffnen nichts verändert. `app/src/features/protokolle/collab/golden.test.ts`
 * vergleicht diese Tabelle mit `getSchema(EXTENSIONS)`: Ändert sich das Schema, wird der Test rot.
 */
export const NODE_DEFAULTS: Record<string, Record<string, unknown>> = {
  heading: { level: 1 },
  orderedList: { start: 1 },
  taskItem: { checked: false },
  tableHeader: { colspan: 1, rowspan: 1 },
  tableCell: { colspan: 1, rowspan: 1 },
  ink: { variant: 'block' },
  photo: { src: '', w: 0, h: 0, caption: '' },
  attachment: { name: 'Datei', mime: 'application/octet-stream', size: 0, data: '' },
};

export const MARK_DEFAULTS: Record<string, Record<string, unknown>> = {
  link: { target: '_blank', rel: 'noopener noreferrer nofollow' },
};

/** Grenzen gegen feindliche Eingaben (wie `validateContent`). */
export const MAX_DEPTH = 100;
export const MAX_NODES = 300_000;

export interface Limits {
  maxDepth?: number;
  maxNodes?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

interface Counter {
  nodes: number;
  maxNodes: number;
  maxDepth: number;
}

function counter(limits: Limits): Counter {
  return { nodes: 0, maxNodes: limits.maxNodes ?? MAX_NODES, maxDepth: limits.maxDepth ?? MAX_DEPTH };
}

function enter(c: Counter, depth: number): void {
  if (depth > c.maxDepth) throw new ConvertError('Inhalt ist zu tief verschachtelt');
  if (++c.nodes > c.maxNodes) throw new ConvertError('Inhalt hat zu viele Knoten');
}

/** Ein Wert, wie er in JSON stehen darf (kommt ein Y-Dokument von außen, können auch Binärdaten, `undefined` oder Zyklen darin stecken). */
function plainJson(v: unknown, depth = 0): boolean {
  if (depth > 50) return false;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => plainJson(x, depth + 1));
  if (isRecord(v)) {
    // ProseMirror legt Attribute als Objekt ohne Prototyp an; aus Bytes dekodiert Yjs gewöhnliche Objekte.
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) return Object.values(v).every((x) => plainJson(x, depth + 1));
  }
  return false;
}

/**
 * Yjs kodiert Text und Zeichenketten als UTF-8: Ein einzelnes Surrogat (ein halbes Emoji, etwa durch Abschneiden) wird dabei zu U+FFFD.
 * Der Konverter tut das gleich beim Bauen, damit Inhalt und Zustand verglichen werden können; sonst bliebe ein solcher Text für immer
 * unumgestellt, weil die Gegenprobe ihn für verändert hält.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const scrub = (s: string): string => s.replace(LONE_SURROGATE, '\uFFFD');

function scrubDeep(v: unknown): unknown {
  if (typeof v === 'string') return scrub(v);
  if (Array.isArray(v)) return v.map(scrubDeep);
  if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)]));
  return v;
}

/**
 * Attribute ohne `null` und `undefined`, davor die Vorgaben. Ein ausdrückliches `null` bei einem Attribut mit Vorgabe lässt die Vorgabe
 * stehen: So liest es der Editor (y-tiptap schreibt `null` nie, das Schema füllt die Vorgabe), und die Struktur ist kanonisch.
 */
function attrsOf(defaults: Record<string, unknown> | undefined, given: unknown): Record<string, unknown> {
  if (given !== undefined && given !== null && !isRecord(given)) throw new ConvertError('Attribute sind kein Objekt');
  const out: Record<string, unknown> = { ...defaults };
  for (const [k, v] of Object.entries(given ?? {})) {
    if (v === null || v === undefined) continue;
    out[k] = scrubDeep(v);
  }
  return out;
}

// ---------- JSON → Y ----------

interface Run {
  text: string;
  marks: DocMark[] | undefined;
}

function textOf(runs: Run[]): Y.XmlText {
  const text = new Y.XmlText();
  text.applyDelta(
    runs.map((r) => {
      const attributes: Record<string, unknown> = {};
      for (const m of r.marks ?? []) {
        if (!isRecord(m) || typeof m.type !== 'string' || !m.type) throw new ConvertError('Markierung ohne Typ');
        attributes[m.type] = attrsOf(MARK_DEFAULTS[m.type], m.attrs);
      }
      return { insert: scrub(r.text), attributes };
    }),
  );
  return text;
}

function childrenOf(content: unknown, c: Counter, depth: number): (Y.XmlElement | Y.XmlText)[] {
  if (content === undefined) return [];
  if (!Array.isArray(content)) throw new ConvertError('Inhalt eines Knotens ist keine Liste');
  const out: (Y.XmlElement | Y.XmlText)[] = [];
  let run: Run[] = [];
  const flush = () => {
    if (run.length) out.push(textOf(run));
    run = [];
  };
  for (const n of content as DocNode[]) {
    if (!isRecord(n) || typeof n.type !== 'string' || !n.type) throw new ConvertError('Knoten ohne Typ');
    if (n.type === 'text') {
      enter(c, depth);
      if (typeof n.text !== 'string') throw new ConvertError('Textknoten ohne Text');
      if (n.text !== '') run.push({ text: n.text, marks: n.marks });
    } else {
      flush();
      out.push(elementOf(n, c, depth));
    }
  }
  flush();
  return out;
}

function elementOf(node: DocNode, c: Counter, depth: number): Y.XmlElement {
  enter(c, depth);
  if (node.type === 'doc') throw new ConvertError('Verschachteltes Dokument');
  const el = new Y.XmlElement(node.type);
  for (const [k, v] of Object.entries(attrsOf(NODE_DEFAULTS[node.type], node.attrs))) el.setAttribute(k, v as never);
  const children = childrenOf(node.content, c, depth + 1);
  if (children.length) el.insert(0, children);
  return el;
}

/** Füllt das Fragment mit dem Inhalt aus ProseMirror-JSON (`{ type: 'doc', content: [...] }`). */
export function fillFragment(fragment: Y.XmlFragment, json: unknown, limits: Limits = {}): void {
  if (!isRecord(json) || json.type !== 'doc') throw new ConvertError('Inhalt ist kein Dokument');
  const c = counter(limits);
  const blocks = childrenOf(json.content, c, 1);
  if (blocks.some((b) => b instanceof Y.XmlText)) throw new ConvertError('Text außerhalb eines Absatzes');
  if (blocks.length) fragment.insert(0, blocks);
}

/** Neues Y-Dokument mit diesem Inhalt (die Basis eines Altbestands). */
export function jsonToYDoc(json: unknown, limits: Limits = {}): Y.Doc {
  const doc = new Y.Doc();
  fillFragment(doc.getXmlFragment(FIELD), json, limits);
  return doc;
}

// ---------- Y → JSON ----------

/**
 * `bold--hash` → `bold`: y-tiptap hängt bei Markierungen, die sich überlappen dürfen, einen Hash von acht Zeichen an und erkennt genau diese
 * Form wieder (`yattr2markname`); alles andere gilt dort als eigener, unbekannter Name. Der Zwilling in der App (`markName` in
 * `collab/yJson.ts`) liest dasselbe; ein Test hält beide gleich.
 */
const markName = (key: string): string => /^(.*)--[a-zA-Z0-9+/=]{8}$/.exec(key)?.[1] ?? key;

function marksOf(attributes: unknown): DocMark[] | undefined {
  if (attributes === undefined || attributes === null) return undefined;
  if (!isRecord(attributes)) throw new ConvertError('Formatierung ist kein Objekt');
  const marks: DocMark[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === false || value === undefined) continue; // so löscht Yjs ein Format
    if (value !== true && !plainJson(value)) throw new ConvertError('Formatierung mit ungültigem Wert');
    const attrs = isRecord(value) ? attrsOf(undefined, value) : {};
    marks.push(Object.keys(attrs).length ? { type: markName(key), attrs } : { type: markName(key) });
  }
  return marks.length ? marks : undefined;
}

function textNodesOf(text: Y.XmlText, c: Counter, depth: number): DocNode[] {
  const out: DocNode[] = [];
  for (const op of text.toDelta() as { insert: unknown; attributes?: unknown }[]) {
    if (typeof op.insert !== 'string') throw new ConvertError('Eingebettetes Objekt im Text');
    if (op.insert === '') continue;
    enter(c, depth);
    const marks = marksOf(op.attributes);
    out.push(marks ? { type: 'text', text: op.insert, marks } : { type: 'text', text: op.insert });
  }
  return out;
}

function nodeOf(el: Y.XmlElement, c: Counter, depth: number): DocNode {
  enter(c, depth);
  const attrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(el.getAttributes())) {
    if (v === null || v === undefined) continue;
    if (!plainJson(v)) throw new ConvertError('Attribut mit ungültigem Wert');
    attrs[k] = v;
  }
  const content: DocNode[] = [];
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlElement) content.push(nodeOf(child, c, depth + 1));
    else if (child instanceof Y.XmlText) content.push(...textNodesOf(child, c, depth + 1));
    else throw new ConvertError('Unbekannter Bestandteil im Dokument');
  }
  const node: DocNode = { type: el.nodeName };
  if (Object.keys(attrs).length) node.attrs = attrs;
  if (content.length) node.content = content;
  return node;
}

/**
 * ProseMirror-JSON des Dokuments. Prüft dabei streng die Form (nur Elemente auf der obersten Ebene, Text nur in Elementen, Attribute
 * und Formate aus reinem JSON): Ein Update, das etwas anderes baut, würde bei den Clients das Rendern abbrechen.
 */
export function yDocToJson(doc: Y.Doc, limits: Limits = {}): DocNode {
  const c = counter(limits);
  const content: DocNode[] = [];
  for (const child of doc.getXmlFragment(FIELD).toArray()) {
    if (!(child instanceof Y.XmlElement)) throw new ConvertError(child instanceof Y.XmlText ? 'Text außerhalb eines Absatzes' : 'Unbekannter Bestandteil im Dokument');
    content.push(nodeOf(child, c, 1));
  }
  return { type: 'doc', content };
}

// ---------- kanonische Form (für die Gegenprobe der Umstellung) ----------

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (isRecord(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return v;
}

function canonicalMarks(marks: DocMark[] | undefined): DocMark[] | undefined {
  if (!marks?.length) return undefined;
  const out = marks.map((m) => {
    const attrs = attrsOf(MARK_DEFAULTS[m.type], m.attrs);
    return Object.keys(attrs).length ? { type: m.type, attrs } : { type: m.type };
  });
  return out.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

function canonicalChildren(content: DocNode[] | undefined): DocNode[] {
  const out: DocNode[] = [];
  for (const n of content ?? []) {
    if (n.type === 'text') {
      if (!n.text) continue;
      const text = scrub(n.text);
      const marks = canonicalMarks(n.marks);
      const last = out[out.length - 1];
      if (last?.type === 'text' && JSON.stringify(stable(last.marks)) === JSON.stringify(stable(marks))) last.text += text;
      else out.push(marks ? { type: 'text', text, marks } : { type: 'text', text });
    } else {
      out.push(canonicalNode(n));
    }
  }
  return out;
}

function canonicalNode(n: DocNode): DocNode {
  const out: DocNode = { type: n.type };
  const attrs = attrsOf(NODE_DEFAULTS[n.type], n.attrs);
  if (Object.keys(attrs).length) out.attrs = attrs;
  const content = canonicalChildren(n.content);
  if (content.length) out.content = content;
  return out;
}

/**
 * Inhalt in einer Form, die sich vergleichen lässt: Vorgaben ergänzt, `null` weg, benachbarte Texte mit gleichen Formaten zusammen,
 * Formate sortiert, Schlüssel sortiert. Zwei Inhalte, die der Editor gleich darstellt, ergeben denselben Text.
 */
export function canonicalJson(json: unknown): string {
  if (!isRecord(json) || json.type !== 'doc') throw new ConvertError('Inhalt ist kein Dokument');
  return JSON.stringify(stable({ type: 'doc', content: canonicalChildren(json.content as DocNode[] | undefined) }));
}
