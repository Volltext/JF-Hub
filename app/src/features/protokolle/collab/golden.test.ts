import { getSchema, type JSONContent } from '@tiptap/core';
import { initProseMirrorDoc, prosemirrorToYXmlFragment, updateYFragment } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { canonicalJson, FIELD, jsonToYDoc, MARK_DEFAULTS, NODE_DEFAULTS, yDocToJson } from '../../../../../server/src/collab/convert';
import { demoData } from '../../../../../server/src/demoData';
import { EXTENSIONS } from '../editorSchema';
import { docProblem, vocabularyProblem, yDocToJson as appYDocToJson } from './yJson';

/**
 * Golden-Test: Der Konverter des Servers (schema-frei) muss genau das Yjs-Dokument bauen und lesen, das @tiptap/y-tiptap mit dem echten
 * Editor-Schema baut und liest. Dokumente gehen nur als Update-Bytes über die Paketgrenze (Server und App haben je eine Kopie von Yjs).
 */
const schema = getSchema(EXTENSIONS);

const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const t = (text: string, marks?: JSONContent['marks']): JSONContent => (marks ? { type: 'text', text, marks } : { type: 'text', text });

/** Von Hand gebaute Dokumente, zusammen decken sie jeden Knoten und jede Markierung des Schemas ab. */
const HAND: Record<string, JSONContent> = {
  text: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [t('Titel')] }, p(t('Normal, '), t('fett', [{ type: 'bold' }]), t(' und '), t('beides', [{ type: 'bold' }, { type: 'italic' }]), t('.')), p(t('eins'), { type: 'hardBreak' }, t('zwei'))] },
  marks: {
    type: 'doc',
    content: [
      p(
        t('unter', [{ type: 'underline' }]),
        t(' '),
        t('durch', [{ type: 'strike' }]),
        t(' '),
        t('code', [{ type: 'code' }]),
        t(' '),
        t('Seite', [{ type: 'link', attrs: { href: 'https://beispiel.de/x', target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null } }]),
        t(' '),
        t('markiert', [{ type: 'highlight', attrs: { color: '#ffe066' } }]),
        t(' '),
        t('gelb', [{ type: 'highlight', attrs: { color: null } }]),
      ),
    ],
  },
  lists: {
    type: 'doc',
    content: [
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('Punkt')), { type: 'orderedList', attrs: { start: 3, type: null }, content: [{ type: 'listItem', content: [p(t('innen'))] }] }] }] },
      { type: 'orderedList', attrs: { start: 1, type: null }, content: [{ type: 'listItem', content: [p(t('eins'))] }, { type: 'listItem', content: [p(t('zwei'))] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('erledigt'))] }, { type: 'taskItem', attrs: { checked: false }, content: [p(t('offen'))] }] },
      { type: 'blockquote', content: [p(t('Zitat'))] },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const x = 1;')] },
      { type: 'horizontalRule' },
    ],
  },
  table: {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2, rowspan: 1, colwidth: null, align: null }, content: [p(t('Kopf'))] }] },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', attrs: { colspan: 1, rowspan: 2, colwidth: [120], align: null }, content: [p(t('A')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('Liste in Zelle'))] }] }] },
              { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [p()] },
            ],
          },
        ],
      },
      p(),
    ],
  },
  anhaenge: {
    type: 'doc',
    content: [
      { type: 'ink', attrs: { ink: { strokes: [{ pts: [[0, 0], [10, 12.5]], w: 2 }], w: 300, h: 100, bg: null }, variant: 'block' } },
      { type: 'photo', attrs: { src: '', w: 800, h: 600, caption: 'Teich', blobId: 'abc123xyz', mime: null } },
      { type: 'attachment', attrs: { name: 'Plan.pdf', mime: 'application/pdf', size: 1234, data: '', blobId: 'def456uvw' } },
      p(t('Text danach')),
    ],
  },
  /** Von Hand erzeugte Inhalte lassen Vorgaben des Schemas weg. */
  sparsam: {
    type: 'doc',
    content: [
      { type: 'heading', content: [t('ohne Stufe')] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('x'))] }] },
      { type: 'taskList', content: [{ type: 'taskItem', content: [p(t('y'))] }] },
      { type: 'photo', attrs: { blobId: 'nur-die-kennung' } },
      { type: 'attachment', attrs: { blobId: 'nur-die-kennung2', name: 'a.txt' } },
      p(t('mit Link', [{ type: 'link', attrs: { href: 'https://x.de' } }])),
    ],
  },
  leer: { type: 'doc', content: [] },
  leererAbsatz: { type: 'doc', content: [{ type: 'paragraph' }] },
};

const demo = demoData(new Date('2026-10-09T12:00:00Z'), { jana: 'jana', tobias: 'tobias' });
const CORPUS: [string, JSONContent][] = [...Object.entries(HAND), ...demo.protocols.map((d, i): [string, JSONContent] => [`Demo ${i + 1}: ${d.title}`, d.content as JSONContent])];

/** Ein Dokument des Servers, im Format der App-Kopie von Yjs. */
function fromServer(json: JSONContent): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(jsonToYDoc(json)));
  return doc;
}

/** Wie der Editor das Dokument ins Y-Dokument schreibt (ProseMirror-Dokument → Y). */
function fromEditor(json: JSONContent): Y.Doc {
  const doc = new Y.Doc();
  prosemirrorToYXmlFragment(schema.nodeFromJSON(json), doc.getXmlFragment(FIELD));
  return doc;
}

describe('Konverter des Servers gegen y-tiptap', () => {
  it('die Tabelle der Vorgaben entspricht dem Schema', () => {
    const defaults = (attrs: Record<string, { default?: unknown }> | undefined) =>
      Object.fromEntries(Object.entries(attrs ?? {}).filter(([, a]) => a.default !== null && a.default !== undefined).map(([k, a]) => [k, a.default]));
    for (const [name, type] of Object.entries(schema.nodes)) {
      if (name === 'doc' || name === 'text') continue;
      expect(NODE_DEFAULTS[name] ?? {}, `Knoten ${name}`).toEqual(defaults(type.spec.attrs as never));
    }
    for (const [name, type] of Object.entries(schema.marks)) expect(MARK_DEFAULTS[name] ?? {}, `Markierung ${name}`).toEqual(defaults(type.spec.attrs as never));
    expect(Object.keys(NODE_DEFAULTS).filter((n) => !schema.nodes[n])).toEqual([]);
    expect(Object.keys(MARK_DEFAULTS).filter((n) => !schema.marks[n])).toEqual([]);
  });

  it('keine Markierung des Schemas darf sich mit sich selbst überlappen (y-tiptap hängt sonst einen Hash an den Namen)', () => {
    for (const [name, mark] of Object.entries(schema.marks)) expect(mark.excludes(mark), name).toBe(true);
  });

  it('die handgebauten Dokumente decken jeden Knoten und jede Markierung des Schemas ab', () => {
    const seen = new Set<string>();
    const walk = (n: JSONContent) => {
      seen.add(n.type!);
      for (const m of n.marks ?? []) seen.add(`mark:${m.type}`);
      n.content?.forEach(walk);
    };
    Object.values(HAND).forEach(walk);
    const all = [...Object.keys(schema.nodes).filter((n) => n !== 'doc'), ...Object.keys(schema.marks).map((m) => `mark:${m}`)];
    expect(all.filter((n) => !seen.has(n))).toEqual([]);
  });

  describe.each(CORPUS)('%s', (_name, json) => {
    it('Server → y-tiptap: derselbe Inhalt wie das Editor-Schema ihn liest', () => {
      const ydoc = fromServer(json);
      const before = ydoc.getXmlFragment(FIELD).toString();
      const { doc } = initProseMirrorDoc(ydoc.getXmlFragment(FIELD), schema);
      expect(canonicalJson(doc.toJSON())).toBe(canonicalJson(json));
      // y-tiptap hat nichts aus dem geteilten Dokument gelöscht (es löscht, was es nicht bauen kann)
      expect(ydoc.getXmlFragment(FIELD).toString()).toBe(before);
    });

    it('y-tiptap → Server: der Server liest, was der Editor schreibt', () => {
      const out = yDocToJson(fromEditor(json));
      expect(canonicalJson(out)).toBe(canonicalJson(json));
    });

    it('beide bauen dieselbe Struktur (Elemente, Attribute, Texte und Formate)', () => {
      // y-tiptap speichert in Formaten auch Attribute mit dem Wert null (`class="null"`), der Server lässt sie weg; beim Vergleich der
      // Attribute (`equalAttrs`) zählen null-Werte nicht.
      const plain = (xml: string) => xml.replace(/ \w+="null"/g, '');
      const a = plain(fromServer(json).getXmlFragment(FIELD).toString());
      const b = plain(fromEditor(json).getXmlFragment(FIELD).toString());
      expect(a).toBe(b);
    });

    it('Laden erzeugt kein Update: Der Editor schreibt beim Abgleich nichts ins Dokument', () => {
      const ydoc = fromServer(json);
      const { doc, meta } = initProseMirrorDoc(ydoc.getXmlFragment(FIELD), schema);
      let updates = 0;
      ydoc.on('update', () => updates++);
      // wie das erste Update der Ansicht (die Knoten sind zugeordnet) …
      updateYFragment(ydoc, ydoc.getXmlFragment(FIELD), doc, meta);
      // … und streng, ohne Zuordnung: jeder Knoten wird mit der Y-Struktur verglichen
      updateYFragment(ydoc, ydoc.getXmlFragment(FIELD), doc, { mapping: new Map(), isOMark: new Map() } as never);
      expect(updates).toBe(0);
    });

    it('Server-Konverter und Editor-Bytes ergeben dasselbe JSON auch nach dem Zusammenführen', () => {
      const a = fromServer(json);
      const b = new Y.Doc();
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
      expect(canonicalJson(yDocToJson(b))).toBe(canonicalJson(json));
    });
  });
});

describe('App-Zwilling von yDocToJson', () => {
  describe.each(CORPUS)('%s', (_name, json) => {
    it('liest dasselbe wie der Konverter des Servers (aus beiden Quellen)', () => {
      for (const ydoc of [fromServer(json), fromEditor(json)]) {
        expect(appYDocToJson(ydoc)).toEqual(yDocToJson(ydoc));
      }
    });

    it('besteht die Vokabularprüfung des Editors', () => {
      expect(docProblem(fromServer(json))).toBeNull();
      expect(docProblem(fromEditor(json))).toBeNull();
    });
  });
});

describe('Vokabularprüfung: was der Editor nicht bauen kann, wird nie gebunden', () => {
  const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

  it('erkennt ein unbekanntes Element, eine unbekannte Markierung und unbekannte Attribute', () => {
    expect(vocabularyProblem(doc({ type: 'callout', content: [p(t('x'))] }))).toContain('Unbekanntes Element „callout“');
    expect(vocabularyProblem(doc(p(t('x', [{ type: 'sparkle' }]))))).toContain('Unbekannte Markierung „sparkle“');
    expect(vocabularyProblem(doc({ type: 'heading', attrs: { level: 2, fancy: true }, content: [t('x')] }))).toContain('Unbekanntes Attribut „fancy“');
    expect(vocabularyProblem(doc(p(t('x', [{ type: 'link', attrs: { href: 'https://a.de', glow: 1 } }]))))).toContain('Unbekanntes Attribut „glow“ der Markierung „link“');
  });

  it('erkennt einen ungültigen Attributwert und eine verletzte Inhaltsregel', () => {
    const cell = (colspan: number) => ({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan, rowspan: 1 }, content: [p(t('x'))] }] }] });
    expect(vocabularyProblem(doc(cell(2)))).toBeNull();
    expect(vocabularyProblem(doc(cell(1_000_000)))).not.toBeNull();
    expect(vocabularyProblem(doc({ type: 'listItem', content: [p(t('x'))] }))).not.toBeNull(); // ein Listenpunkt gehört in eine Liste
    expect(vocabularyProblem(doc({ type: 'tableRow', content: [] }))).not.toBeNull();
  });

  it('ein leeres Dokument ist gültig (der Editor legt den ersten Absatz beim Tippen an)', () => {
    expect(vocabularyProblem(doc())).toBeNull();
  });

  it('erkennt Y-Strukturen, die kein Editor baut', () => {
    const topText = new Y.Doc();
    const x = new Y.XmlText();
    x.insert(0, 'lose');
    topText.getXmlFragment(FIELD).insert(0, [x]);
    expect(docProblem(topText)).toContain('Text außerhalb eines Absatzes');

    const odd = new Y.Doc();
    const el = new Y.XmlElement('paragraph');
    el.setAttribute('daten', new Uint8Array([1, 2, 3]) as never);
    odd.getXmlFragment(FIELD).insert(0, [el]);
    expect(docProblem(odd)).toContain('ungültigem Wert');

    const fromAuthor = new Y.Doc();
    const unknown = new Y.XmlElement('callout');
    fromAuthor.getXmlFragment(FIELD).insert(0, [unknown]);
    expect(docProblem(fromAuthor)).toContain('Unbekanntes Element „callout“');
  });
});
