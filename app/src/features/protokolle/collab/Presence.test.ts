import { describe, expect, it } from 'vitest';
import { peersLabel } from './Presence';

describe('peersLabel', () => {
  it('nennt die Mitschreibenden in lesbarer Form', () => {
    expect(peersLabel([])).toBe('');
    expect(peersLabel(['Anna'])).toBe('Anna ist auch hier');
    expect(peersLabel(['Anna', 'Ben'])).toBe('Anna und Ben sind auch hier');
    expect(peersLabel(['Anna', 'Ben', 'Cem'])).toBe('Anna, Ben und Cem sind auch hier');
    expect(peersLabel(['Anna', 'Ben', 'Cem', 'Dora', 'Emil'])).toBe('Anna, Ben und 3 weitere sind auch hier');
  });
});
