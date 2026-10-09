import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_PHOTO_BYTES, fitWithin, formatBytes } from './limits';

describe('fitWithin', () => {
  it('verkleinert die längste Kante und behält das Verhältnis', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ w: 1200, h: 1600 });
  });
  it('vergrößert nie', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ w: 800, h: 600 });
  });
});

describe('Grenzen', () => {
  it('stimmen mit dem Server überein', () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_PHOTO_BYTES).toBe(6 * 1024 * 1024);
  });
});

describe('formatBytes', () => {
  it('formatiert lesbar', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 kB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3,0 MB');
  });
});
