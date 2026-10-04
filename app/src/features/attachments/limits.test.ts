import { describe, expect, it } from 'vitest';
import { attachmentChars, fitWithin, formatBytes } from './limits';

describe('fitWithin', () => {
  it('verkleinert die längste Kante und behält das Verhältnis', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ w: 1200, h: 1600 });
  });
  it('vergrößert nie', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ w: 800, h: 600 });
  });
});

describe('attachmentChars', () => {
  it('zählt Fotos und Dateien auch in Verschachtelungen', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
        { type: 'photo', attrs: { src: 'a'.repeat(10) } },
        { type: 'blockquote', content: [{ type: 'attachment', attrs: { data: 'b'.repeat(5) } }] },
      ],
    };
    expect(attachmentChars(doc)).toBe(15);
    expect(attachmentChars(undefined)).toBe(0);
  });
});

describe('formatBytes', () => {
  it('formatiert lesbar', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 kB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3,0 MB');
  });
});
