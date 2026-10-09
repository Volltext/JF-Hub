import { describe, expect, it } from 'vitest';
import { getSchema, type JSONContent } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { InkNode } from '@/features/ink/InkNode';
import { FileNode, PhotoNode } from '@/features/attachments/AttachmentNodes';
import { EXTENSIONS, SCHEMA_VERSION, schemaAccepts } from './editorSchema';

const text = (t: string, marks?: NonNullable<JSONContent['marks']>): JSONContent => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const para = (...c: JSONContent[]): JSONContent => ({ type: 'paragraph', content: c });
const doc = (...c: JSONContent[]): JSONContent => ({ type: 'doc', content: c });
const cell = (type: 'tableCell' | 'tableHeader', content: JSONContent[], attrs: Record<string, unknown> = {}): JSONContent => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null, ...attrs },
  content,
});
const table = (...rows: JSONContent[][]): JSONContent => ({ type: 'table', content: rows.map((cells) => ({ type: 'tableRow', content: cells })) });
const linkMark = (href: string) => ({ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null } });
const marker = (color: string | null = null) => ({ type: 'highlight', attrs: { color } });

describe('schemaAccepts', () => {
  it('kennt alles, was der Editor heute erzeugt', () => {
    const all = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Titel')] },
      para(text('fett', [{ type: 'bold' }]), text(' kursiv', [{ type: 'italic' }]), text(' unterstrichen', [{ type: 'underline' }]), text(' durchgestrichen', [{ type: 'strike' }]), text(' Code', [{ type: 'code' }])),
      para(text('Link', [linkMark('https://example.de')]), text(' und '), text('markiert', [marker()])),
      { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('Punkt'))] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [para(text('Eins'))] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [para(text('Erledigt'))] }] },
      { type: 'blockquote', content: [para(text('Zitat'))] },
      { type: 'horizontalRule' },
      { type: 'codeBlock', content: [text('x = 1')] },
      table([cell('tableHeader', [para(text('Name'))]), cell('tableHeader', [para(text('Status'))])], [cell('tableCell', [para(text('Anna'))]), cell('tableCell', [para(text('da'))])]),
      { type: 'ink', attrs: { variant: 'block', ink: { v: 1, w: 800, h: 200, bg: 'none', s: [] } } },
      { type: 'photo', attrs: { src: 'data:image/jpeg;base64,AAAA', w: 10, h: 10, caption: 'Foto' } },
      { type: 'attachment', attrs: { name: 'Plan.pdf', mime: 'application/pdf', size: 10, data: 'AAAA' } },
    );
    expect(schemaAccepts(all)).toBe(true);
  });

  it('nimmt leere und fehlende Inhalte an', () => {
    expect(schemaAccepts(undefined)).toBe(true);
    expect(schemaAccepts({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true);
  });

  it('erkennt Knoten, die diese Version nicht kennt (zum Beispiel ein Hinweisfeld aus einer neueren)', () => {
    expect(schemaAccepts(doc(para(text('Davor')), { type: 'callout', content: [para(text('x'))] }))).toBe(false);
    expect(schemaAccepts(doc({ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'fremdknoten' }] }] }))).toBe(false); // auch tief verschachtelt
    expect(schemaAccepts(doc(table([cell('tableCell', [{ type: 'fremdknoten' }])])))).toBe(false); // auch in einer Zelle
  });

  it('erkennt unbekannte Markierungen (zum Beispiel Kommentare aus einer neueren Version)', () => {
    expect(schemaAccepts(doc(para(text('kommentiert', [{ type: 'comment' }]))))).toBe(false);
    expect(schemaAccepts(doc(para(text('x', [{ type: 'spoiler' }]))))).toBe(false);
  });

  it('reicht Foto- und Dateiverweise durch, die ein späteres Update einführt (blobId, mime)', () => {
    const photo = { type: 'photo', attrs: { src: '', w: 800, h: 600, caption: 'Teich', blobId: 'blob-123456', mime: 'image/jpeg' } };
    const file = { type: 'attachment', attrs: { name: 'Plan.pdf', mime: 'application/pdf', size: 10, data: '', blobId: 'blob-654321' } };
    expect(schemaAccepts(doc(photo, file))).toBe(true);
    // Der Editor schreibt beim Speichern `schema.nodeFromJSON(...).toJSON()`: nichts darf dabei verloren gehen.
    const out = getSchema(EXTENSIONS).nodeFromJSON(doc(photo, file)).toJSON() as { content: { attrs: Record<string, unknown> }[] };
    expect(out.content[0]!.attrs).toMatchObject({ blobId: 'blob-123456', mime: 'image/jpeg', caption: 'Teich', w: 800, h: 600 });
    expect(out.content[1]!.attrs).toMatchObject({ blobId: 'blob-654321', name: 'Plan.pdf' });
  });
});

describe('Tabellen, Links und Hervorhebung (Schema 4)', () => {
  const schema = getSchema(EXTENSIONS);
  const roundtrip = (d: JSONContent) => schema.nodeFromJSON(d).toJSON();

  it('eine Tabelle übersteht Laden und Speichern unverändert, auch Spannen, Spaltenbreiten und Ausrichtung', () => {
    const d = doc(
      table(
        [cell('tableHeader', [para(text('Name'))]), cell('tableHeader', [para(text('Wer'))], { colspan: 2, colwidth: [120, 80] })],
        [
          cell('tableCell', [para(text('Anna'))], { rowspan: 2, align: 'center' }),
          cell('tableCell', [{ type: 'bulletList', content: [{ type: 'listItem', content: [para(text('Schlauch'))] }] }]),
          cell('tableCell', [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [para(text('da'))] }] }]),
        ],
      ),
    );
    expect(roundtrip(d)).toEqual(d);
    expect(schemaAccepts(d)).toBe(true);
  });

  it('ein Link behält Ziel und Zusatzangaben', () => {
    const d = doc(para(text('Webseite', [linkMark('https://example.de/seite?x=1')]), text(' und '), text('Mail', [linkMark('mailto:anna@example.de')])));
    expect(roundtrip(d)).toEqual(d);
  });

  it('die Hervorhebung behält ihre Farbangabe, auch wenn der Editor noch keine anbietet', () => {
    const d = doc(para(text('gelb', [marker(null)]), text('grün', [marker('#b7f0c0')])));
    expect(roundtrip(d)).toEqual(d);
  });

  it('Links zeigen nur erlaubte Ziele (http, https, mailto, tel); alles andere wird ohne Ziel ausgegeben', () => {
    const href = (h: string) => (schema.marks.link!.spec.toDOM!(schema.marks.link!.create({ href: h }), true) as unknown as [string, Record<string, string>, 0])[1].href;
    for (const ok of ['https://example.de', 'http://example.de/x', 'mailto:a@example.de', 'tel:+49170123456']) expect(href(ok), ok).toBe(ok);
    for (const bad of ['javascript:alert(1)', ' javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://example.de', 'sms:+49170123456', '/relativ', '#anker', 'example.de']) expect(href(bad), bad).toBe('');
  });

  it('die Markerfarbe wird nur als #rrggbb ausgegeben', () => {
    const attrs = (color: unknown) => (schema.marks.highlight!.spec.toDOM!(schema.marks.highlight!.create({ color }), true) as unknown as [string, Record<string, string>, 0])[1];
    expect(attrs('#FFEE00')).toEqual({ 'data-color': '#ffee00', style: 'background-color: #ffee00; color: inherit' });
    for (const bad of [null, '', 'red', 'red;position:fixed', 'url(x)', '#fff', '#ggg000', 42]) expect(attrs(bad), String(bad)).toEqual({});
  });

  it('Zellen nehmen Absätze und Listen auf, keine Tabellen, Fotos oder Zeichnungen', () => {
    const make = (name: string) => schema.nodes[name]!.createAndFill() ?? schema.nodes[name]!.create();
    const accepts = (cellType: string, ...names: string[]) => schema.nodes[cellType]!.validContent(Fragment.from(names.map(make)));
    for (const t of ['tableCell', 'tableHeader']) {
      expect(accepts(t, 'paragraph'), t).toBe(true);
      expect(accepts(t, 'paragraph', 'bulletList', 'orderedList', 'taskList'), t).toBe(true);
      for (const n of ['table', 'photo', 'attachment', 'ink', 'horizontalRule', 'blockquote', 'codeBlock', 'heading']) expect(accepts(t, n), `${t} ${n}`).toBe(false);
    }
  });

  it('eine neue Tabelle hat Zellen mit einem leeren Absatz', () => {
    expect(schema.nodes.tableCell!.createAndFill()!.toJSON()).toMatchObject({ type: 'tableCell', content: [{ type: 'paragraph' }] });
  });

  it('Apps bis 2.2.x (Schema 3) kennen diese Elemente nicht und lesen solche Protokolle nur', () => {
    // So sieht die Prüfung in einer App vor 2.3.0 aus: dieselbe Liste ohne Link, Hervorhebung und Tabellen.
    const schema3 = getSchema([StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }), TaskList, TaskItem.configure({ nested: true }), InkNode, PhotoNode, FileNode]);
    const withTable = doc(table([cell('tableCell', [para(text('x'))])]));
    const withLink = doc(para(text('Link', [linkMark('https://example.de')])));
    const withMarker = doc(para(text('markiert', [marker()])));
    for (const d of [withTable, withLink, withMarker]) {
      expect(() => schema3.nodeFromJSON(d)).toThrow();
      expect(schemaAccepts(d)).toBe(true); // diese Version kennt sie
    }
  });

  it('SCHEMA_VERSION 4 gehört zu dieser Liste von Erweiterungen', () => {
    expect(SCHEMA_VERSION).toBe(4);
  });
});
