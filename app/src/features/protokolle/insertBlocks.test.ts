import { describe, expect, it } from 'vitest';
import { getSchema, type JSONContent } from '@tiptap/core';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { EXTENSIONS } from './editorSchema';
import { afterTable } from './insertBlocks';

const schema = getSchema(EXTENSIONS);
const p = (t: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const cell = (t: string): JSONContent => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [p(t)] });
const doc = schema.nodeFromJSON({
  type: 'doc',
  content: [p('Davor'), { type: 'table', content: [{ type: 'tableRow', content: [cell('A1'), cell('B1')] }] }, p('Danach')],
});

/** Position, an der der Text `needle` beginnt. */
function posOf(needle: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text === needle) found = pos;
  });
  expect(found, needle).toBeGreaterThanOrEqual(0);
  return found;
}

const stateAt = (pos: number) => EditorState.create({ doc, selection: TextSelection.create(doc, pos) });

describe('afterTable', () => {
  it('liefert die Stelle hinter der Tabelle, wenn der Cursor in einer Zelle steht', () => {
    const after = afterTable(stateAt(posOf('A1') + 1).selection);
    expect(after).not.toBeNull();
    // Direkt davor liegt die Tabelle, direkt danach der Absatz „Danach“.
    expect(doc.resolve(after!).nodeBefore?.type.name).toBe('table');
    expect(doc.resolve(after!).nodeAfter?.textContent).toBe('Danach');
    expect(afterTable(stateAt(posOf('B1')).selection)).toBe(after); // egal, in welcher Zelle
  });

  it('liefert null außerhalb von Tabellen', () => {
    expect(afterTable(stateAt(posOf('Davor') + 2).selection)).toBeNull();
    expect(afterTable(stateAt(posOf('Danach')).selection)).toBeNull();
  });

  it('gilt auch für eine ausgewählte Tabelle oder Zelle', () => {
    const tableStart = posOf('A1') - 4; // table > row > cell > paragraph > Text
    const node = doc.nodeAt(tableStart)!;
    expect(node.type.name).toBe('table');
    const selected = EditorState.create({ doc, selection: NodeSelection.create(doc, tableStart) });
    // Eine ausgewählte Tabelle ist selbst kein Elternteil der Auswahl: Der Einfüger setzt dann an der Auswahl selbst ein.
    expect(afterTable(selected.selection)).toBeNull();
  });
});
