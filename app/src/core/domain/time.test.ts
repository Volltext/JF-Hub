import { describe, expect, it } from 'vitest';
import { nowTime, parseTypedTime } from './time';

describe('parseTypedTime', () => {
  it.each([
    ['1730', 17, 30],
    ['17:30', 17, 30],
    ['930', 9, 30],
    ['9', 9, 0],
    ['9.30', 9, 30],
    ['7:5', 7, 50],
    ['0000', 0, 0],
  ])('%s', (text, h, min) => expect(parseTypedTime(text)).toEqual({ h, min }));

  it.each(['', '25:00', '12:60', 'abc', '12345'])('lehnt „%s“ ab', (text) => expect(parseTypedTime(text)).toBeNull());
});

describe('nowTime', () => {
  it('formatiert mit führenden Nullen', () => expect(nowTime(new Date(2026, 9, 2, 7, 5))).toBe('07:05'));
});
