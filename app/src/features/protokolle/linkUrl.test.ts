import { describe, expect, it } from 'vitest';
import { allowedLink, displayUrl, normalizeUrl } from './linkUrl';

describe('allowedLink', () => {
  it('erlaubt http, https, mailto und tel', () => {
    for (const u of ['https://example.de', 'http://example.de/pfad?x=1#a', 'HTTPS://EXAMPLE.DE', 'mailto:anna@example.de', 'mailto:anna@example.de?subject=Hallo', 'tel:+491701234567', 'tel:0170-1234567']) {
      expect(allowedLink(u), u).toBe(true);
    }
  });

  it('lehnt alles andere ab: Skripte, Daten, Dateien, relative und unvollständige Adressen', () => {
    const bad = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html;base64,AAAA',
      'file:///etc/passwd',
      'ftp://example.de',
      'sms:+49170123456',
      'vbscript:x',
      '/relativ',
      '#anker',
      '?x=1',
      '//example.de',
      'example.de',
      '',
      ' ',
      'https://',
      'https:///pfad',
      'https://exa mple.de',
      ' https://example.de',
      'https://example.de ',
      'mailto:',
      'tel:',
      'tel:abc',
    ];
    for (const u of bad) expect(allowedLink(u), JSON.stringify(u)).toBe(false);
    for (const v of [null, undefined, 42, {}, []]) expect(allowedLink(v)).toBe(false);
  });

  it('begrenzt die Länge auf 2000 Zeichen', () => {
    const base = 'https://example.de/';
    expect(allowedLink(base + 'a'.repeat(2000 - base.length))).toBe(true);
    expect(allowedLink(base + 'a'.repeat(2001 - base.length))).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('lässt gültige Adressen unverändert (bis auf umgebende Leerzeichen)', () => {
    expect(normalizeUrl('https://example.de/a?b=1')).toBe('https://example.de/a?b=1');
    expect(normalizeUrl('  http://example.de  ')).toBe('http://example.de');
    expect(normalizeUrl('mailto:anna@example.de')).toBe('mailto:anna@example.de');
  });

  it('ergänzt https:// bei Webadressen ohne Schema', () => {
    expect(normalizeUrl('example.de')).toBe('https://example.de');
    expect(normalizeUrl('www.example.de/pfad')).toBe('https://www.example.de/pfad');
    expect(normalizeUrl('example.de:8080/x')).toBe('https://example.de:8080/x');
    expect(normalizeUrl('192.168.0.5')).toBe('https://192.168.0.5');
    expect(normalizeUrl('192.168.0.5:8080')).toBe('https://192.168.0.5:8080');
    expect(normalizeUrl('localhost:8080')).toBe('https://localhost:8080');
  });

  it('erkennt E-Mail-Adressen und Telefonnummern', () => {
    expect(normalizeUrl('anna@example.de')).toBe('mailto:anna@example.de');
    expect(normalizeUrl('+49 170 1234567')).toBe('tel:+491701234567');
    expect(normalizeUrl('0170 / 123 45 67')).toBe('tel:01701234567');
    expect(normalizeUrl('(0170) 123-4567')).toBe('tel:01701234567');
    expect(normalizeUrl('tel:+49 170 1234567')).toBe('tel:+491701234567');
  });

  it('kurze Nummern wie der Notruf sind Telefonnummern, bloße Zahlen mit Punkten keine Webadressen', () => {
    expect(normalizeUrl('112')).toBe('tel:112');
    expect(normalizeUrl('110')).toBe('tel:110');
    expect(normalizeUrl('116 117')).toBe('tel:116117');
    expect(allowedLink('tel:112')).toBe(true);
    // „12“, „1.2.3“ und ein Datum sind weder Nummer noch Adresse (URL macht aus „https://12“ den Host „0.0.0.12“)
    for (const u of ['12', '1.2.3', '12.10.2026', '1.2.3.4.5']) expect(normalizeUrl(u), u).toBeNull();
  });

  it('lehnt unzulässige Ziele ab', () => {
    const bad = [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'ftp://example.de',
      'sms:+49170123456',
      '/relativ',
      '#anker',
      '//example.de',
      'Feuerwehr', // kein Ziel, nur ein Wort
      'zwei Wörter.de',
      'a@b',
      'https://',
      'http://exa mple.de',
      '',
      '   ',
      'x'.repeat(2001),
      'example.de\nzweite Zeile',
    ];
    for (const u of bad) expect(normalizeUrl(u), JSON.stringify(u)).toBeNull();
  });

  it('liefert nur Ziele, die auch allowedLink akzeptiert', () => {
    for (const u of ['example.de', 'anna@example.de', '+49 170 1234567', 'https://example.de/x', 'localhost:3000', '192.168.0.5']) {
      const n = normalizeUrl(u);
      expect(n && allowedLink(n), u).toBe(true);
    }
  });
});

describe('displayUrl', () => {
  it('kürzt Webadressen auf Host und Pfad', () => {
    expect(displayUrl('https://www.example.de/')).toBe('example.de');
    expect(displayUrl('https://example.de/ordner/datei.pdf?x=1#a')).toBe('example.de/ordner/datei.pdf');
    expect(displayUrl('http://example.de:8080/x')).toBe('example.de:8080/x');
  });

  it('schneidet zu lange Adressen mit … ab', () => {
    const shown = displayUrl('https://example.de/' + 'a'.repeat(100));
    expect(shown).toHaveLength(40);
    expect(shown.endsWith('…')).toBe(true);
    expect(displayUrl('https://example.de/' + 'a'.repeat(100), 20)).toHaveLength(20);
  });

  it('zeigt bei mailto und tel Adresse und Nummer', () => {
    expect(displayUrl('mailto:anna@example.de?subject=Hallo')).toBe('anna@example.de');
    expect(displayUrl('tel:+491701234567')).toBe('+491701234567');
  });
});
