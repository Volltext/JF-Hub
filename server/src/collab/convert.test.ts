import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { canonicalJson, ConvertError, FIELD, jsonToYDoc, MARK_DEFAULTS, NODE_DEFAULTS, yDocToJson, type DocNode } from './convert.js';

const p = (...content: DocNode[]): DocNode => ({ type: 'paragraph', content });
const t = (text: string, marks?: DocNode['marks']): DocNode => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });

const roundTrip = (json: DocNode): DocNode => yDocToJson(jsonToYDoc(json));

describe('jsonToYDoc / yDocToJson', () => {
  it('Absätze mit Text und Formaten bleiben erhalten', () => {
    const json = doc(p(t('Hallo '), t('fett', [{ type: 'bold' }]), t(' und '), t('kursiv fett', [{ type: 'bold' }, { type: 'italic' }])), p(t('Zweiter Absatz')));
    expect(canonicalJson(roundTrip(json))).toBe(canonicalJson(json));
  });

  it('benachbarte Texte mit gleichen Formaten werden ein Text, mit verschiedenen bleiben es mehrere Läufe in einem Y.XmlText', () => {
    const json = doc(p(t('a'), t('b'), t('c', [{ type: 'bold' }])));
    const ydoc = jsonToYDoc(json);
    const paragraph = ydoc.getXmlFragment(FIELD).get(0) as Y.XmlElement;
    expect(paragraph.length).toBe(1); // ein einziges Y.XmlText, wie y-tiptap es anlegt
    expect(roundTrip(json)).toEqual(doc(p(t('ab'), t('c', [{ type: 'bold' }]))));
  });

  it('ein Absatz mit hardBreak ergibt Text, Element, Text', () => {
    const json = doc(p(t('eins'), { type: 'hardBreak' }, t('zwei')));
    const paragraph = jsonToYDoc(json).getXmlFragment(FIELD).get(0) as Y.XmlElement;
    expect(paragraph.length).toBe(3);
    expect(paragraph.get(0)).toBeInstanceOf(Y.XmlText);
    expect(paragraph.get(1)).toBeInstanceOf(Y.XmlElement);
    expect(canonicalJson(roundTrip(json))).toBe(canonicalJson(json));
  });

  it('leere Absätze, leeres Dokument und leere Textknoten', () => {
    expect(roundTrip(doc())).toEqual(doc());
    expect(roundTrip(doc({ type: 'paragraph' }))).toEqual(doc({ type: 'paragraph' }));
    expect(roundTrip(doc(p(t(''))))).toEqual(doc({ type: 'paragraph' }));
  });

  it('Attribute: null fällt weg, Vorgaben des Schemas werden ergänzt', () => {
    const json = doc({ type: 'heading', attrs: { level: 2 }, content: [t('Titel')] }, { type: 'heading', content: [t('ohne Stufe')] }, { type: 'orderedList', attrs: { start: 1, type: null }, content: [] });
    const out = roundTrip(json);
    expect(out.content![0]!.attrs).toEqual({ level: 2 });
    expect(out.content![1]!.attrs).toEqual({ level: 1 });
    expect(out.content![2]!.attrs).toEqual({ start: 1 });
    const heading = jsonToYDoc(json).getXmlFragment(FIELD).get(0) as Y.XmlElement;
    expect(heading.getAttributes()).toEqual({ level: 2 });
  });

  it('ein ausdrückliches null bei einem Attribut mit Vorgabe gilt als Vorgabe (so liest es der Editor), auch in der kanonischen Form', () => {
    const json = doc({ type: 'orderedList', attrs: { start: null }, content: [{ type: 'listItem', content: [p(t('1'))] }] }, { type: 'heading', attrs: { level: null }, content: [t('H')] });
    const y = jsonToYDoc(json);
    expect((y.getXmlFragment(FIELD).get(0) as Y.XmlElement).getAttributes()).toEqual({ start: 1 });
    expect((y.getXmlFragment(FIELD).get(1) as Y.XmlElement).getAttributes()).toEqual({ level: 1 });
    expect(canonicalJson(roundTrip(json))).toBe(canonicalJson(json));
  });

  it('einzelne Surrogate (halbe Emoji) werden zu U+FFFD, in Text und Attributen: Yjs kodiert als UTF-8, die Gegenprobe darf daran nicht scheitern', () => {
    const json = doc(p(t('ab\uD83Dcd'), t('ef\uDE00', [{ type: 'bold' }])), { type: 'photo', attrs: { caption: 'Bild \uD800' } }, p(t('ganz 😀 heil')));
    const out = roundTrip(json);
    expect(canonicalJson(out)).toBe(canonicalJson(json));
    expect(JSON.stringify(out)).toContain('ab\uFFFDcd');
    expect(JSON.stringify(out)).toContain('ganz 😀 heil'); // ein vollständiges Paar bleibt
    expect(JSON.stringify(out).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')).not.toMatch(/[\uD800-\uDFFF]/); // kein einzelnes Surrogat übrig
  });

  it('Listen, Aufgaben und Tabellen mit Attributen', () => {
    const json = doc(
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('Punkt')), { type: 'orderedList', attrs: { start: 3, type: null }, content: [{ type: 'listItem', content: [p(t('innen'))] }] }] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('erledigt'))] }, { type: 'taskItem', attrs: { checked: false }, content: [p(t('offen'))] }] },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2, rowspan: 1, colwidth: null, align: null }, content: [p(t('Kopf'))] }] },
          { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [120], align: null }, content: [p(t('Zelle'))] }, { type: 'tableCell', content: [p()] }] },
        ],
      },
    );
    const out = roundTrip(json);
    expect(canonicalJson(out)).toBe(canonicalJson(json));
    // colwidth ist ein Feld mit Zahlen: es überlebt als Wert
    const row = out.content![2]!.content![1]!;
    expect(row.content![0]!.attrs).toMatchObject({ colspan: 1, rowspan: 1, colwidth: [120] });
    expect(row.content![1]!.attrs).toEqual({ colspan: 1, rowspan: 1 });
  });

  it('Handschrift (Objekt-Attribut), Foto und Datei behalten ihre Attribute', () => {
    const ink = { strokes: [{ pts: [[0, 0], [10, 12.5]], w: 2 }], w: 300, h: 100 };
    const json = doc(
      { type: 'ink', attrs: { ink, variant: 'block' } },
      { type: 'photo', attrs: { src: '', w: 800, h: 600, caption: 'Teich', blobId: 'abc123xyz', mime: null } },
      { type: 'attachment', attrs: { name: 'Plan.pdf', mime: 'application/pdf', size: 1234, data: '', blobId: 'def456uvw' } },
    );
    const out = roundTrip(json);
    expect(out.content![0]!.attrs!.ink).toEqual(ink);
    expect(out.content![1]!.attrs).toEqual({ src: '', w: 800, h: 600, caption: 'Teich', blobId: 'abc123xyz' });
    expect(out.content![2]!.attrs).toMatchObject({ name: 'Plan.pdf', blobId: 'def456uvw' });
    expect(canonicalJson(out)).toBe(canonicalJson(json));
  });

  it('Link mit Attributen, Hervorhebung mit Farbe, Code', () => {
    const link = { type: 'link', attrs: { href: 'https://beispiel.de', target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null } };
    const json = doc(p(t('Seite', [link]), t(' '), t('wichtig', [{ type: 'highlight', attrs: { color: '#ffe066' } }]), t(' '), t('x=1', [{ type: 'code' }])));
    const out = roundTrip(json);
    const marks = out.content![0]!.content!.map((n) => n.marks);
    expect(marks[0]).toEqual([{ type: 'link', attrs: { href: 'https://beispiel.de', target: '_blank', rel: 'noopener noreferrer nofollow' } }]);
    expect(marks[2]).toEqual([{ type: 'highlight', attrs: { color: '#ffe066' } }]);
    expect(marks[4]).toEqual([{ type: 'code' }]);
    expect(canonicalJson(out)).toBe(canonicalJson(json));
  });

  it('Formate im Y.XmlText stehen unter dem Namen der Markierung (ohne Attribute: leeres Objekt)', () => {
    const ydoc = jsonToYDoc(doc(p(t('a', [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://x.de' } }]))));
    const text = (ydoc.getXmlFragment(FIELD).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    const delta = text.toDelta() as { insert: string; attributes: Record<string, unknown> }[];
    expect(delta).toHaveLength(1);
    expect(delta[0]!.attributes.bold).toEqual({});
    expect(delta[0]!.attributes.link).toEqual({ href: 'https://x.de', ...MARK_DEFAULTS.link });
  });

  it('ein angehängter Hash beim Format wird abgeschnitten', () => {
    const ydoc = new Y.Doc();
    const text = new Y.XmlText();
    const paragraph = new Y.XmlElement('paragraph');
    ydoc.getXmlFragment(FIELD).insert(0, [paragraph]);
    paragraph.insert(0, [text]);
    text.insert(0, 'Wort', { 'bold--abc123': {} });
    expect(yDocToJson(ydoc)).toEqual(doc(p(t('Wort', [{ type: 'bold' }]))));
  });

  it('zwei Clients, die zusammenführen, ergeben dasselbe JSON', () => {
    const a = jsonToYDoc(doc(p(t('Basis'))));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    (a.getXmlFragment(FIELD).get(0) as Y.XmlElement & { get(i: number): Y.XmlText }).get(0) as Y.XmlText;
    ((a.getXmlFragment(FIELD).get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(5, ' von A');
    ((b.getXmlFragment(FIELD).get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'B: ');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(yDocToJson(a)).toEqual(yDocToJson(b));
    expect(JSON.stringify(yDocToJson(a))).toContain('von A');
    expect(JSON.stringify(yDocToJson(a))).toContain('B: ');
  });

  it('die Tabelle der Vorgaben deckt nur Attribute ab, die nicht null sind', () => {
    for (const defaults of [...Object.values(NODE_DEFAULTS), ...Object.values(MARK_DEFAULTS)]) {
      for (const value of Object.values(defaults)) expect(value).not.toBeNull();
    }
  });
});

describe('strenge Prüfung', () => {
  it('lehnt ungültige Eingaben ab', () => {
    const bad: unknown[] = [
      null,
      {},
      { type: 'paragraph' },
      { type: 'doc', content: 'text' },
      { type: 'doc', content: [{ type: 'text', text: 'lose' }] },
      { type: 'doc', content: [{ content: [] }] },
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text' }] }] },
      { type: 'doc', content: [{ type: 'paragraph', attrs: 'x' }] },
      { type: 'doc', content: [{ type: 'doc' }] },
      { type: 'doc', content: [p(t('x', [{ type: '' }]))] },
    ];
    for (const json of bad) expect(() => jsonToYDoc(json), JSON.stringify(json)).toThrow(ConvertError);
  });

  it('begrenzt Tiefe und Knotenzahl', () => {
    let deep: DocNode = p(t('tief'));
    for (let i = 0; i < 5; i++) deep = { type: 'blockquote', content: [deep] };
    expect(() => jsonToYDoc(doc(deep), { maxDepth: 4 })).toThrow(/tief/);
    expect(() => jsonToYDoc(doc(deep), { maxDepth: 20 })).not.toThrow();
    expect(() => jsonToYDoc(doc(p(t('a')), p(t('b')), p(t('c'))), { maxNodes: 4 })).toThrow(/Knoten/);
    const ydoc = jsonToYDoc(doc(deep));
    expect(() => yDocToJson(ydoc, { maxDepth: 4 })).toThrow(/tief/);
  });

  it('ein Y-Dokument mit Text auf der obersten Ebene wird abgelehnt', () => {
    const ydoc = new Y.Doc();
    const text = new Y.XmlText();
    ydoc.getXmlFragment(FIELD).insert(0, [text]);
    text.insert(0, 'lose');
    expect(() => yDocToJson(ydoc)).toThrow(/Text außerhalb/);
  });

  it('ein Y-Dokument mit Hook, Binärattribut oder Einbettung wird abgelehnt', () => {
    const hook = new Y.Doc();
    hook.getXmlFragment(FIELD).insert(0, [new Y.XmlHook('x')]);
    expect(() => yDocToJson(hook)).toThrow(ConvertError);

    const binary = new Y.Doc();
    const el = new Y.XmlElement('ink');
    binary.getXmlFragment(FIELD).insert(0, [el]);
    el.setAttribute('ink', new Uint8Array([1, 2, 3]) as never);
    expect(() => yDocToJson(binary)).toThrow(/Attribut/);

    const embed = new Y.Doc();
    const paragraph = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    embed.getXmlFragment(FIELD).insert(0, [paragraph]);
    paragraph.insert(0, [text]);
    text.insertEmbed(0, { bild: 'x' });
    expect(() => yDocToJson(embed)).toThrow(/Eingebettet/);
  });
});

describe('canonicalJson', () => {
  it('ist unabhängig von Vorgaben, null, Reihenfolge der Formate und Textaufteilung', () => {
    const a = doc({ type: 'heading', content: [t('A'), t('B')] }, p(t('x', [{ type: 'italic' }, { type: 'bold' }])));
    const b = doc({ type: 'heading', attrs: { level: 1 }, content: [t('AB')] }, p(t('x', [{ type: 'bold' }, { type: 'italic' }])));
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(doc(p(t('a'))))).not.toBe(canonicalJson(doc(p(t('b')))));
    expect(canonicalJson(doc(p(t('a', [{ type: 'bold' }]))))).not.toBe(canonicalJson(doc(p(t('a')))));
  });
});
