import { describe, expect, it } from 'vitest';
import { safeLink } from '../../../../server/src/pdf';
import { allowedLink } from './linkUrl';

/** Der Editor (`allowedLink`) und das PDF (`safeLink` im Server) müssen dieselben Link-Ziele zulassen: Zwei Listen, die auseinanderlaufen, wären ein Loch. */
describe('Link-Allowlist: App und PDF entscheiden gleich', () => {
  const schemes = ['https://', 'http://', 'HTTPS://', 'mailto:', 'tel:', 'ftp://', 'javascript:', 'data:', '//', '/', '', 'https:/', 'https:///'];
  const hosts = [
    'example.de', 'a', 'a.b', '[', '[::1]', '%', '256.256.256.256', '1.2.3.4', 'host\\pfad', '@host', 'u@host', 'müller.de', 'exa mple.de', '',
    ':99999', ':80', 'a:b', 'anna@example.de', '+49170123456', '0170-123', '110',
  ];
  const tails = ['', '/', '/x', '?q=1', '#a', ' ', '\n', ' ', '/größe', '\\', '%zz', '\u0000'];

  it('lässt für jede Kombination aus Schema, Host und Rest genau dieselben Adressen zu', () => {
    let n = 0;
    for (const s of schemes) {
      for (const h of hosts) {
        for (const t of tails) {
          const url = s + h + t;
          n++;
          expect(safeLink(url) !== null, JSON.stringify(url)).toBe(allowedLink(url));
        }
      }
    }
    expect(n).toBeGreaterThan(3000);
  });

  it('lehnt alles ab, was keine Zeichenkette ist', () => {
    for (const v of [null, undefined, 42, {}, [], true]) {
      expect(safeLink(v)).toBeNull();
      expect(allowedLink(v)).toBe(false);
    }
  });

  it('liefert für erlaubte Ziele reines ASCII, das auf dieselbe Adresse zeigt', () => {
    for (const url of ['https://example.de/ä', 'https://müller.de', 'mailto:jörg@example.de', 'tel:+49170123456', 'http://example.de:8080/x?y=1#z']) {
      expect(allowedLink(url), url).toBe(true);
      expect(safeLink(url), url).toMatch(/^[\x21-\x7e]+$/);
    }
  });
});
