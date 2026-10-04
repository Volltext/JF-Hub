import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { emptyInk, fitBlockHeight, INK_BLOCK_MIN_HEIGHT, inkBottom, isInkEmpty, normalizeInk, roundInk } from './inkModel';
import { inkSvg } from './inkSvg';

const stroke = (t: 'p' | 'h', p: number[], w = 2.6) => ({ t, c: '#1b1d21', w, p });

describe('inkModel', () => {
  it('prüft und bereinigt unbekannte Daten', () => {
    expect(normalizeInk(null)).toBeNull();
    expect(normalizeInk({ s: 'x' })).toBeNull();
    const doc = normalizeInk({
      w: 800,
      h: 500,
      bg: 'kaputt',
      s: [{ t: 'h', c: 'rot', w: 999, p: [1, 2, 0.5, 3, 4] }, { p: [1] }, { t: 'p', c: '#ff0000', w: 2, p: [0, 0, 1, 5, 5, 1] }],
    })!;
    expect(doc.bg).toBe('none');
    expect(doc.s).toHaveLength(2);
    expect(doc.s[0]).toMatchObject({ t: 'h', c: '#1b1d21', w: 80, p: [1, 2, 0.5] });
    expect(doc.s[1]!.c).toBe('#ff0000');
  });

  it('behält Zeit- und Längenangaben der App, wenn sie passen', () => {
    const doc = normalizeInk({ s: [{ t: 'p', c: '#112233', w: 2, p: [0, 0, 1, 1, 1, 1], d: [8, 9.4], u: 0.002 }, { p: [0, 0, 1, 1, 1, 1], d: [8] }] })!;
    expect(doc.s[0]).toMatchObject({ d: [8, 9], u: 0.002 });
    expect(doc.s[1]!.d).toBeUndefined();
  });

  it('kürzt Zeichenflächen im Text auf den Inhalt', () => {
    const doc = emptyInk('block');
    expect(fitBlockHeight(doc).h).toBe(INK_BLOCK_MIN_HEIGHT);
    doc.s.push(stroke('p', [10, 900, 0.5, 20, 910, 0.5]));
    expect(inkBottom(doc)).toBeCloseTo(912.6);
    expect(fitBlockHeight(doc).h).toBe(973);
    expect(emptyInk('page').h).toBe(1131);
    expect(isInkEmpty(doc)).toBe(false);
    expect(isInkEmpty(emptyInk('page'))).toBe(true);
  });

  it('rundet Koordinaten und Druck', () => {
    const r = roundInk({ ...emptyInk('block'), s: [stroke('p', [1.2345, 2.3456, 0.55555])] });
    expect(r.s[0]!.p).toEqual([1.2, 2.3, 0.56]);
  });
});

describe('inkSvg', () => {
  it('zeichnet Stift als Fläche, Textmarker als halbtransparente Linie darunter', () => {
    const doc = { ...emptyInk('block'), s: [stroke('p', [10, 10, 0.5, 40, 12, 0.6, 80, 30, 0.7]), stroke('h', [0, 50, 1, 100, 50, 1], 24)] };
    const svg = inkSvg(doc);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 800 360"');
    expect(svg.indexOf('stroke-opacity')).toBeLessThan(svg.indexOf('fill="#1b1d21"'));
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('kommt mit Punkt, Doppelpunkten und leerem Blatt zurecht', () => {
    expect(inkSvg({ ...emptyInk('block'), s: [stroke('p', [5, 5, 0.5])] })).toContain('a');
    expect(inkSvg({ ...emptyInk('block'), s: [stroke('p', [5, 5, 0.5, 5, 5, 0.5, 5.1, 5, 0.5])] })).not.toMatch(/NaN/);
    expect(inkSvg(emptyInk('block'))).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 360"></svg>');
  });

  it('zeichnet Blatthintergründe und schreibt auf Wunsch feste Größe', () => {
    const lined = inkSvg({ ...emptyInk('page') });
    expect(lined).toContain('stroke="#d5dae2"');
    expect(inkSvg({ ...emptyInk('page'), bg: 'none' })).not.toContain('<path');
    expect(inkSvg({ ...emptyInk('page'), bg: 'grid' })).toContain('V1131');
    expect(inkSvg({ ...emptyInk('page'), bg: 'dots' }, { fixedSize: true })).toContain('width="800" height="1131"');
    expect(inkSvg({ ...emptyInk('page') }, { background: false })).not.toContain('<path');
  });

  it('bleibt wortgleich mit der Kopie im Server', () => {
    const server = fileURLToPath(new URL('../../../../jf-hub-server/src/inkSvg.ts', import.meta.url));
    if (!existsSync(server)) return;
    const mine = readFileSync(fileURLToPath(new URL('./inkSvg.ts', import.meta.url)), 'utf8');
    expect(readFileSync(server, 'utf8').replace(/\r\n/g, '\n')).toBe(mine.replace(/\r\n/g, '\n'));
  });
});
