import { describe, expect, it } from 'vitest';
import { jsonEqual } from './equal';

describe('jsonEqual', () => {
  it('vergleicht einfache Werte', () => {
    expect(jsonEqual('a', 'a')).toBe(true);
    expect(jsonEqual('a', 'b')).toBe(false);
    expect(jsonEqual(1, 1)).toBe(true);
    expect(jsonEqual(1, '1')).toBe(false);
    expect(jsonEqual(null, null)).toBe(true);
    expect(jsonEqual(null, undefined)).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
  });

  it('vergleicht verschachtelte Dokumente unabhängig von der Schlüsselreihenfolge', () => {
    const a = { type: 'doc', content: [{ type: 'paragraph', attrs: { x: 1, y: [1, 2] }, content: [{ type: 'text', text: 'Hi' }] }] };
    const b = { content: [{ content: [{ text: 'Hi', type: 'text' }], attrs: { y: [1, 2], x: 1 }, type: 'paragraph' }], type: 'doc' };
    expect(jsonEqual(a, b)).toBe(true);
    expect(jsonEqual(a, { ...b, type: 'x' })).toBe(false);
  });

  it('erkennt Unterschiede in Listen', () => {
    expect(jsonEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
  });

  it('behandelt undefined-Schlüssel wie fehlende', () => {
    expect(jsonEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(jsonEqual({ a: 1, b: null }, { a: 1 })).toBe(false);
  });
});
