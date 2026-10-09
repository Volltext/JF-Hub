import { describe, expect, it } from 'vitest';
import { getSchema, type JSONContent } from '@tiptap/core';
import { EXTENSIONS, schemaAccepts } from './editorSchema';

const text = (t: string, marks?: { type: string }[]): JSONContent => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const para = (...c: JSONContent[]): JSONContent => ({ type: 'paragraph', content: c });
const doc = (...c: JSONContent[]): JSONContent => ({ type: 'doc', content: c });

describe('schemaAccepts', () => {
  it('kennt alles, was der Editor heute erzeugt', () => {
    const all = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Titel')] },
      para(text('fett', [{ type: 'bold' }]), text(' kursiv', [{ type: 'italic' }]), text(' unterstrichen', [{ type: 'underline' }]), text(' durchgestrichen', [{ type: 'strike' }]), text(' Code', [{ type: 'code' }])),
      { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('Punkt'))] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [para(text('Eins'))] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [para(text('Erledigt'))] }] },
      { type: 'blockquote', content: [para(text('Zitat'))] },
      { type: 'horizontalRule' },
      { type: 'codeBlock', content: [text('x = 1')] },
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

  it('erkennt Knoten, die diese Version nicht kennt (zum Beispiel eine Tabelle aus einer neueren)', () => {
    expect(schemaAccepts(doc(para(text('Davor')), { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para(text('x'))] }] }] }))).toBe(false);
    expect(schemaAccepts(doc({ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'fremdknoten' }] }] }))).toBe(false); // auch tief verschachtelt
  });

  it('erkennt unbekannte Markierungen (zum Beispiel Hervorhebung oder Links aus einer neueren Version)', () => {
    expect(schemaAccepts(doc(para(text('markiert', [{ type: 'highlight' }]))))).toBe(false);
    expect(schemaAccepts(doc(para(text('Link', [{ type: 'link' }]))))).toBe(false); // Links gibt es im Editor (noch) nicht
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
