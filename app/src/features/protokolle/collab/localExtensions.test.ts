import { getExtensionField, getSchema } from '@tiptap/core';
import { EditorState, Plugin } from '@tiptap/pm/state';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { describe, expect, it } from 'vitest';
import { EXTENSIONS } from '../editorSchema';
import { LocalTrailingNode, hasLocalDocChange, isRemote, localOnly } from './localExtensions';

const schema = getSchema(EXTENSIONS);
const photo = { type: 'photo', attrs: { blobId: 'foto-0001', mime: 'image/jpeg', w: 8, h: 6, caption: '' } };
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const stateOf = (content: object[], plugins: Plugin[]) => EditorState.create({ doc: schema.nodeFromJSON({ type: 'doc', content }), plugins });

/** Eine Änderung, wie sie aus dem geteilten Dokument kommt (y-tiptap kennzeichnet sie so). */
const remote = (state: EditorState) => state.tr.insertText('fern', 1).setMeta(ySyncPluginKey, { isChangeOrigin: true });
const local = (state: EditorState) => state.tr.insertText('eigen', 1);

describe('localOnly', () => {
  const touch = new Plugin({ appendTransaction: (_trs, _old, state) => state.tr.insertText('!', state.doc.content.size - 1) });
  const wrapped = localOnly(touch);
  const lastText = (s: EditorState) => s.doc.textContent;

  it('läuft nach einer eigenen Änderung des Textes', () => {
    const s = stateOf([para('a')], [wrapped]);
    expect(lastText(s.apply(local(s)))).toContain('!');
  });

  it('läuft nicht nach einer Änderung aus dem geteilten Dokument und nicht ohne Änderung des Textes', () => {
    const s = stateOf([para('a')], [wrapped]);
    expect(lastText(s.apply(remote(s)))).not.toContain('!');
    expect(lastText(s.apply(s.tr.setMeta('irgendwas', 1)))).not.toContain('!');
  });

  it('ein Plugin ohne appendTransaction bleibt unverändert', () => {
    const plain = new Plugin({});
    expect(localOnly(plain)).toBe(plain);
  });

  it('erkennt den Ursprung', () => {
    const s = stateOf([para('a')], []);
    expect(isRemote(local(s))).toBe(false);
    expect(isRemote(remote(s))).toBe(true);
    expect(hasLocalDocChange([remote(s), s.tr])).toBe(false);
    expect(hasLocalDocChange([remote(s), local(s)])).toBe(true);
  });
});

describe('LocalTrailingNode', () => {
  const plugins = () => (LocalTrailingNode.config.addProseMirrorPlugins as unknown as (this: unknown) => Plugin[]).call({ editor: { schema } });
  const lastType = (s: EditorState) => s.doc.lastChild!.type.name;

  it('hängt nach einer eigenen Änderung einen Absatz hinter ein Foto', () => {
    const s = stateOf([para('Text'), photo], plugins());
    expect(lastType(s)).toBe('photo');
    expect(lastType(s.apply(local(s)))).toBe('paragraph');
  });

  it('schreibt beim Öffnen, beim Anklicken und bei Änderungen anderer Geräte nichts', () => {
    const s = stateOf([para('Text'), photo], plugins());
    expect(lastType(s)).toBe('photo'); // das Öffnen (Zustand anlegen) fügt nichts an
    expect(lastType(s.apply(s.tr.setSelection(s.selection)))).toBe('photo'); // Anklicken
    expect(lastType(s.apply(remote(s)))).toBe('photo'); // Änderung eines anderen Geräts
  });

  it('lässt ein Dokument, das mit einem Absatz endet, in Ruhe', () => {
    const s = stateOf([photo, para('Ende')], plugins());
    const next = s.apply(s.tr.insertText('x', 2)); // im letzten Absatz
    expect(next.doc.childCount).toBe(2);
    expect(next.doc.lastChild!.textContent).toBe('xEnde');
  });

  it('beachtet das Kennzeichen zum Überspringen', () => {
    const s = stateOf([para('Text'), photo], plugins());
    expect(lastType(s.apply(local(s).setMeta('skipTrailingNode', true)))).toBe('photo');
  });
});

describe('Tabellen im geteilten Dokument', () => {
  /** Die Plugins der Tabellen-Erweiterung, wie der Editor sie anlegt. */
  const tablePlugins = (): Plugin[] => {
    const table = EXTENSIONS.find((e) => e.name === 'table')!;
    const context = { name: 'table', options: table.options, storage: {}, editor: { isEditable: true }, type: schema.nodes.table };
    return (getExtensionField(table, 'addProseMirrorPlugins', context as never) as () => Plugin[])();
  };
  const cell = { type: 'tableCell', content: [{ type: 'paragraph' }] };
  const row = (n: number) => ({ type: 'tableRow', content: Array.from({ length: n }, () => cell) });
  /** Drei Zeilen mit 3, 2 und 3 Zellen: Das Schema erlaubt es, `fixTables` ergänzt die fehlende Zelle. */
  const irregular = { type: 'doc', content: [{ type: 'table', content: [row(3), row(2), row(3)] }] };
  const cellsPerRow = (s: EditorState): number[] => {
    const counts: number[] = [];
    s.doc.firstChild!.forEach((r) => counts.push(r.childCount));
    return counts;
  };
  /** Das Dokument wird durch eine frische Fassung ersetzt, wie y-tiptap es beim ersten Rendern und bei Änderungen anderer Geräte tut. */
  const replaced = (s: EditorState, remoteOrigin: boolean) => {
    const fresh = schema.nodeFromJSON(irregular);
    const tr = s.tr.replaceWith(0, s.doc.content.size, fresh.content);
    return remoteOrigin ? tr.setMeta(ySyncPluginKey, { isChangeOrigin: true }) : tr;
  };

  it('ergänzt eine fehlende Zelle nur nach einer eigenen Änderung, beim Öffnen und bei Änderungen anderer Geräte bleibt die Tabelle, wie sie ist', () => {
    const s = EditorState.create({ doc: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] }), plugins: tablePlugins() });
    expect(cellsPerRow(s.apply(replaced(s, true)))).toEqual([3, 2, 3]); // wie beim Öffnen und bei Änderungen anderer: nichts schreiben
    expect(cellsPerRow(s.apply(replaced(s, false)))).toEqual([3, 3, 3]); // die eigene Änderung darf die Tabelle in Ordnung bringen
  });
});
