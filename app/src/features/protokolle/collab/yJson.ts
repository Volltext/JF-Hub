import type { JSONContent } from '@tiptap/core';
import { initProseMirrorDoc } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { appSchema } from '../editorSchema';

/**
 * Liest ein Yjs-Dokument als ProseMirror-JSON und prüft, ob der Editor dieser App-Version es bauen kann.
 *
 * Der Lesezweig ist ein Zwilling von `yDocToJson` in `server/src/collab/convert.ts` (die Web-App wird ohne den Server-Ordner gebaut,
 * deshalb gibt es zwei Kopien; `golden.test.ts` hält sie gleich). Er ist streng: Was kein Editor bauen würde, ist ein Fehler.
 *
 * Wichtig ist die Prüfung davor (`docProblem`). `@tiptap/y-tiptap` löscht aus dem *geteilten* Dokument jedes Element, das es nicht
 * bauen kann (unbekannter Knoten oder Markierung, ungültiges Attribut, verletzter Inhaltsausdruck), und entfernt Attribute, die das
 * eigene Schema nicht kennt. Das träfe alle. Deshalb bindet der Editor nur Dokumente, die diese Prüfung bestehen.
 */

/** Name des `Y.XmlFragment` im Dokument. Muss mit dem Server (`FIELD` in `convert.ts`) übereinstimmen. */
export const FIELD = 'body';

export class ReadError extends Error {}

const MAX_DEPTH = 100;
const MAX_NODES = 300_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

interface Counter {
  nodes: number;
}

function enter(c: Counter, depth: number): void {
  if (depth > MAX_DEPTH) throw new ReadError('Inhalt ist zu tief verschachtelt');
  if (++c.nodes > MAX_NODES) throw new ReadError('Inhalt hat zu viele Knoten');
}

/** Ein Wert, wie er in JSON stehen darf. */
function plainJson(v: unknown, depth = 0): boolean {
  if (depth > 50) return false;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => plainJson(x, depth + 1));
  if (isRecord(v)) {
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) return Object.values(v).every((x) => plainJson(x, depth + 1));
  }
  return false;
}

/**
 * `bold--hash` → `bold`: y-tiptap hängt bei Markierungen, die sich überlappen dürfen, einen Hash von acht Zeichen an. Genau diese Form
 * erkennt es wieder (`yattr2markname`); alles andere gilt dort als eigener, unbekannter Name.
 */
export const markName = (key: string): string => /^(.*)--[a-zA-Z0-9+/=]{8}$/.exec(key)?.[1] ?? key;

function attrsOf(given: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(given)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

function marksOf(attributes: unknown): JSONContent['marks'] {
  if (attributes === undefined || attributes === null) return undefined;
  if (!isRecord(attributes)) throw new ReadError('Formatierung ist kein Objekt');
  const marks: NonNullable<JSONContent['marks']> = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === false || value === undefined) continue; // so löscht Yjs ein Format
    if (value !== true && !plainJson(value)) throw new ReadError('Formatierung mit ungültigem Wert');
    const attrs = isRecord(value) ? attrsOf(value) : {};
    marks.push(Object.keys(attrs).length ? { type: markName(key), attrs } : { type: markName(key) });
  }
  return marks.length ? marks : undefined;
}

function textNodesOf(text: Y.XmlText, c: Counter, depth: number): JSONContent[] {
  const out: JSONContent[] = [];
  for (const op of text.toDelta() as { insert: unknown; attributes?: unknown }[]) {
    if (typeof op.insert !== 'string') throw new ReadError('Eingebettetes Objekt im Text');
    if (op.insert === '') continue;
    enter(c, depth);
    const marks = marksOf(op.attributes);
    out.push(marks ? { type: 'text', text: op.insert, marks } : { type: 'text', text: op.insert });
  }
  return out;
}

function nodeOf(el: Y.XmlElement, c: Counter, depth: number): JSONContent {
  enter(c, depth);
  const attrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(el.getAttributes())) {
    if (v === null || v === undefined) continue;
    if (!plainJson(v)) throw new ReadError('Attribut mit ungültigem Wert');
    attrs[k] = v;
  }
  const content: JSONContent[] = [];
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlElement) content.push(nodeOf(child, c, depth + 1));
    else if (child instanceof Y.XmlText) content.push(...textNodesOf(child, c, depth + 1));
    else throw new ReadError('Unbekannter Bestandteil im Dokument');
  }
  const node: JSONContent = { type: el.nodeName };
  if (Object.keys(attrs).length) node.attrs = attrs;
  if (content.length) node.content = content;
  return node;
}

/** ProseMirror-JSON des Dokuments (`{ type: 'doc', content }`; ein leeres Dokument hat eine leere Liste). */
export function yDocToJson(doc: Y.Doc): JSONContent {
  const c: Counter = { nodes: 0 };
  const content: JSONContent[] = [];
  for (const child of doc.getXmlFragment(FIELD).toArray()) {
    if (!(child instanceof Y.XmlElement)) throw new ReadError(child instanceof Y.XmlText ? 'Text außerhalb eines Absatzes' : 'Unbekannter Bestandteil im Dokument');
    content.push(nodeOf(child, c, 1));
  }
  return { type: 'doc', content };
}

// ---------- Vokabular ----------

function namesOf(spec: { attrs?: Record<string, unknown> } | undefined): Set<string> {
  return new Set(Object.keys(spec?.attrs ?? {}));
}

/**
 * Baut der Editor dieser App-Version genau dieses Dokument? Prüft Knoten, Markierungen, Attributnamen und -werte und die Inhaltsausdrücke
 * des Schemas (`Node.check`). Ein leeres Dokument ist gültig: Der Editor legt den ersten Absatz erst beim Tippen an.
 * Liefert den Grund oder `null`.
 */
export function vocabularyProblem(json: JSONContent): string | null {
  const schema = appSchema();
  const walk = (n: JSONContent): string | null => {
    if (n.type === 'text') {
      for (const m of n.marks ?? []) {
        const mark = schema.marks[m.type];
        if (!mark) return `Unbekannte Markierung „${m.type}“`;
        const known = namesOf(mark.spec as never);
        for (const k of Object.keys(m.attrs ?? {})) if (!known.has(k)) return `Unbekanntes Attribut „${k}“ der Markierung „${m.type}“`;
      }
      return null;
    }
    const type = n.type ? schema.nodes[n.type] : undefined;
    if (!type) return `Unbekanntes Element „${n.type}“`;
    const known = namesOf(type.spec as never);
    for (const k of Object.keys(n.attrs ?? {})) if (!known.has(k)) return `Unbekanntes Attribut „${k}“ von „${n.type}“`;
    for (const child of n.content ?? []) {
      const problem = walk(child);
      if (problem) return problem;
    }
    return null;
  };
  for (const child of json.content ?? []) {
    const problem = walk(child);
    if (problem) return problem;
  }
  if (!json.content?.length) return null;
  try {
    schema.nodeFromJSON(json).check();
  } catch (e) {
    return `Ungültiger Aufbau: ${e instanceof Error ? e.message : 'Inhalt verletzt die Regeln'}`; // die Meldung von ProseMirror ist englisch, hilft aber bei der Suche
  }
  return null;
}

/**
 * Löscht `@tiptap/y-tiptap` beim Binden etwas aus diesem Dokument? Es baut die ProseMirror-Knoten aus dem Y-Baum und entfernt dabei, was es
 * nicht bauen kann. Die Probe läuft auf einer Kopie und fängt jede Abweichung der Prüfung oben von dessen Regeln ab (ein Wert, den das Schema
 * nur beim Bauen ablehnt, ein Format mit unerwartetem Wert), ohne sie nachzubauen. Geändert wird dabei nur die Kopie.
 */
function bindProblem(doc: Y.Doc): string | null {
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc));
    let changed = false;
    probe.on('update', () => (changed = true));
    initProseMirrorDoc(probe.getXmlFragment(FIELD), appSchema());
    return changed ? 'Ungültiger Aufbau: Der Editor würde Teile des Dokuments beim Öffnen entfernen' : null;
  } catch (e) {
    return `Ungültiger Aufbau: ${e instanceof Error ? e.message : 'Der Editor kann das Dokument nicht aufbauen'}`;
  } finally {
    probe.destroy();
  }
}

/** Würde der Editor dieses Y-Dokument ohne Verlust öffnen? Liefert den Grund, warum nicht, oder `null`. */
export function docProblem(doc: Y.Doc): string | null {
  try {
    return vocabularyProblem(yDocToJson(doc)) ?? bindProblem(doc);
  } catch (e) {
    return e instanceof Error ? e.message : 'Ungültiger Inhalt';
  }
}
