import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Variablen eines CSS-Blocks („--name: wert;“), Kommentare entfernt. */
function vars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

/** Inhalt des ersten Blocks hinter `selector` (bis zur passenden schließenden Klammer). */
function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`${selector} fehlt`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`${selector} nicht geschlossen`);
}

const uiDir = fileURLToPath(new URL('.', import.meta.url));
const srcDir = fileURLToPath(new URL('../..', import.meta.url));
const tokens = readFileSync(join(uiDir, 'tokens.css'), 'utf8');
const admin = readFileSync(fileURLToPath(new URL('../../../../server/public/admin/admin.css', import.meta.url)), 'utf8');

describe('Design-Tokens', () => {
  it('die Server-Verwaltung nutzt dieselben Werte wie die App (hell und dunkel)', () => {
    const appDark = vars(block(tokens, ':root {'));
    const appLight = { ...appDark, ...vars(block(tokens, ":root[data-theme='light']")) };
    const adminLight = vars(block(admin, ':root {'));
    const adminDark = { ...adminLight, ...vars(block(block(admin, '@media (prefers-color-scheme: dark)'), ':root {')) };
    for (const [name, value] of Object.entries(adminLight)) {
      expect(appLight[name], `${name} fehlt in der App`).toBeDefined();
      expect(value, `${name} (hell)`).toBe(appLight[name]);
      expect(adminDark[name], `${name} (dunkel)`).toBe(appDark[name]);
    }
  });

  it('Styles der App nutzen Tokens statt fester Farben, Schriftgrößen und Radien', () => {
    const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.css') && !f.endsWith('tokens.css'));
    expect(files.length).toBeGreaterThan(3);
    const found: string[] = [];
    for (const f of files) {
      const css = readFileSync(join(srcDir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const bad = [
        ...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
        ...css.matchAll(/rgba?\(/g),
        ...css.matchAll(/font-size:\s*[0-9.]+(px|rem)/g),
        ...css.matchAll(/font:\s*[0-9]+ [0-9.]+(px|rem)/g),
        ...css.matchAll(/border-radius:\s*[0-9.]+px/g),
      ];
      for (const m of bad) found.push(`${relative(srcDir, join(srcDir, f))}: ${m[0]}`);
    }
    expect(found).toEqual([]);
  });

  it('jede verwendete Variable ist in tokens.css oder im eigenen Stylesheet definiert', () => {
    const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.css'));
    const all = files.map((f) => readFileSync(join(srcDir, f), 'utf8')).join('\n');
    const defined = new Set([...all.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...all.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    expect([...used].filter((v) => !defined.has(v))).toEqual([]);
  });
});
