import { describe, expect, it } from 'vitest';
import { folderKind, forwardSubject, htmlToText, oneLine, parseAddressList, replySubject } from './text.js';

describe('htmlToText', () => {
  it('macht lesbaren Text und entfernt Skripte, Stile und Tracking-Bilder', () => {
    const html = '<html><head><title>x</title><style>p{color:red}</style></head><body><script>alert(1)</script><p>Hallo&nbsp;<b>Welt</b> &amp; Co.</p><p>Zeile 2<br>Zeile 3</p><img src="https://track.example/p.gif"><ul><li>eins</li><li>zwei</li></ul></body></html>';
    const t = htmlToText(html);
    expect(t).toBe('Hallo Welt & Co.\nZeile 2\nZeile 3\n• eins\n• zwei');
    expect(t).not.toMatch(/alert|color|track/);
  });

  it('zeigt Links mit Adresse, damit man sieht, wohin sie führen', () => {
    expect(htmlToText('<a href="https://evil.example/login">Hier klicken</a>')).toBe('Hier klicken (https://evil.example/login)');
    expect(htmlToText('<a href="javascript:alert(1)">klick</a>')).toBe('klick');
    expect(htmlToText('<a href="https://x.de">https://x.de</a>')).toBe('https://x.de');
  });

  it('dekodiert Umlaute und Zeichencodes, lässt Unbekanntes stehen', () => {
    expect(htmlToText('&Auml;rger &#252;ber &#x20AC;5 &unbekannt; &#99999999;')).toBe('Ärger über €5 &unbekannt; &#99999999;');
  });
});

describe('Adressen', () => {
  it('liest Listen mit und ohne Namen, auch Namen mit Komma in Anführungszeichen', () => {
    expect(parseAddressList('Max Muster <max@example.org>, anna@example.org; "Müller, Zoe" <z@example.org>')).toEqual([
      { name: 'Max Muster', address: 'max@example.org' },
      { name: '', address: 'anna@example.org' },
      { name: 'Müller, Zoe', address: 'z@example.org' },
    ]);
  });

  it('lehnt ungültige Adressen und Einschleusen von Kopfzeilen ab', () => {
    for (const bad of ['kein-at', 'a@b', 'a@b.de\nBcc: x@y.de', 'a b@example.org', '<>']) expect(() => parseAddressList(bad), bad).toThrow(/Ungültige/);
    expect(parseAddressList('a@example.org\r\n')).toEqual([{ name: '', address: 'a@example.org' }]);
  });

  it('begrenzt die Zahl der Empfänger', () => {
    const many = Array.from({ length: 31 }, (_, i) => `u${i}@example.org`).join(',');
    expect(() => parseAddressList(many)).toThrow(/Zu viele/);
    expect(parseAddressList(undefined)).toEqual([]);
    expect(parseAddressList(['a@example.org', 'b@example.org']).length).toBe(2);
  });
});

describe('Kleinkram', () => {
  it('oneLine entfernt Zeilenumbrüche', () => {
    expect(oneLine('Betreff\r\nBcc: x@y.de')).toBe('Betreff Bcc: x@y.de');
  });
  it('Betreffzeilen', () => {
    expect(replySubject('Dienstplan')).toBe('Re: Dienstplan');
    expect(replySubject('AW: Dienstplan')).toBe('AW: Dienstplan');
    expect(forwardSubject('Dienstplan')).toBe('Fwd: Dienstplan');
    expect(forwardSubject('WG: Dienstplan')).toBe('WG: Dienstplan');
  });
  it('Ordnerarten', () => {
    expect(folderKind('INBOX')).toBe('inbox');
    expect(folderKind('Gesendet', '\\Sent')).toBe('sent');
    expect(folderKind('Eigener')).toBe('');
  });
});
