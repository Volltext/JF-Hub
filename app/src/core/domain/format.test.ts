import { describe, expect, it } from 'vitest';
import { formatDateRelative } from './format';

describe('formatDateRelative', () => {
  it('nennt heute, gestern und morgen', () => {
    expect(formatDateRelative('2026-11-04', '2026-11-04')).toBe('Heute');
    expect(formatDateRelative('2026-11-03', '2026-11-04')).toBe('Gestern');
    expect(formatDateRelative('2026-11-05', '2026-11-04')).toBe('Morgen');
  });
  it('lässt im laufenden Jahr das Jahr weg, sonst nicht', () => {
    expect(formatDateRelative('2026-10-12', '2026-11-04')).toMatch(/^Mo\.?, 12\.10\.$/);
    expect(formatDateRelative('2025-10-12', '2026-11-04')).toBe('12.10.2025');
  });
});
