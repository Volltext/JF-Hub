import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, loadMailKey, MailKeyError, parseKey } from './crypto.js';

const key = Buffer.alloc(32, 7);

describe('Verschlüsselung der Zugangsdaten', () => {
  it('ver- und entschlüsselt; zweimal derselbe Text ergibt verschiedene Werte', () => {
    const a = encryptSecret(key, 'geheim-äöü');
    const b = encryptSecret(key, 'geheim-äöü');
    expect(a).not.toBe(b);
    expect(a).not.toContain('geheim');
    expect(decryptSecret(key, a)).toBe('geheim-äöü');
  });

  it('erkennt einen falschen Schlüssel und veränderte Werte', () => {
    const enc = encryptSecret(key, 'geheim');
    expect(() => decryptSecret(Buffer.alloc(32, 8), enc)).toThrow(MailKeyError);
    const raw = Buffer.from(enc.slice(3), 'base64');
    raw[raw.length - 1]! ^= 1;
    expect(() => decryptSecret(key, 'v1:' + raw.toString('base64'))).toThrow(MailKeyError);
    expect(() => decryptSecret(key, 'klartext')).toThrow(MailKeyError);
    expect(() => decryptSecret(key, 'v1:AAAA')).toThrow(MailKeyError);
  });

  it('nimmt nur echte 32-Byte-Schlüssel an', () => {
    expect(parseKey('a'.repeat(64)).length).toBe(32);
    expect(parseKey(Buffer.alloc(32, 1).toString('base64')).length).toBe(32);
    for (const bad of ['', 'zu-kurz', 'g'.repeat(64), 'a'.repeat(63)]) expect(() => parseKey(bad), bad).toThrow(MailKeyError);
  });

  it('legt die Schlüsseldatei einmal an (nur für den Besitzer lesbar) und liest sie danach wieder', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'jfh-key-')), 'daten', 'mail.key');
    const first = loadMailKey({ file });
    expect(first.length).toBe(32);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o077).toBe(0);
    expect(loadMailKey({ file }).equals(first)).toBe(true);
    expect(parseKey(readFileSync(file, 'utf8')).equals(first)).toBe(true);
  });

  it('die Umgebungsvariable geht vor; eine kaputte Datei ist ein Fehler statt eines stillen Neuanfangs', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'jfh-key-')), 'mail.key');
    expect(loadMailKey({ env: 'b'.repeat(64), file }).equals(Buffer.alloc(32, 0xbb))).toBe(true);
    writeFileSync(file, 'kaputt');
    expect(() => loadMailKey({ file })).toThrow(MailKeyError);
  });
});
