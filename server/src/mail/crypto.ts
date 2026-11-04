import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Zugangsdaten der Postfächer liegen verschlüsselt in der Datenbank (AES-256-GCM). Der Schlüssel steht nie in der Datenbank
 * und damit auch in keinem Backup: Er kommt aus `MAIL_KEY` (Umgebung) oder aus der Datei `mail.key` im Datenordner, die beim
 * ersten Bedarf angelegt wird. Wer nur ein Backup der Datenbank hat, kommt nicht an die Passwörter.
 */

const PREFIX = 'v1:';

export class MailKeyError extends Error {}

/** Schlüssel aus Text: 32 Bytes als Hex (64 Zeichen) oder Base64. Alles andere ist zu schwach und wird abgelehnt. */
export function parseKey(text: string): Buffer {
  const t = text.trim();
  if (/^[0-9a-f]{64}$/i.test(t)) return Buffer.from(t, 'hex');
  if (/^[A-Za-z0-9+/]{43}=?$/.test(t)) {
    const b = Buffer.from(t, 'base64');
    if (b.length === 32) return b;
  }
  throw new MailKeyError('MAIL_KEY muss 32 Zufallsbytes sein (64 Hex-Zeichen), zum Beispiel erzeugt mit: openssl rand -hex 32');
}

/** Liest den Schlüssel aus der Umgebung oder der Schlüsseldatei; legt die Datei an (Rechte 0600), falls es sie nicht gibt. */
export function loadMailKey(opts: { env?: string; file: string }): Buffer {
  if (opts.env && opts.env.trim()) return parseKey(opts.env);
  if (existsSync(opts.file)) return parseKey(readFileSync(opts.file, 'utf8'));
  const key = randomBytes(32);
  mkdirSync(dirname(opts.file), { recursive: true });
  writeFileSync(opts.file, key.toString('hex') + '\n', { mode: 0o600 });
  try {
    chmodSync(opts.file, 0o600);
  } catch {
    /* auf manchen Dateisystemen (z. B. Windows-Freigaben) nicht möglich */
  }
  return key;
}

/** Verschlüsselt einen Text; das Ergebnis enthält Version, Nonce, Tag und Chiffretext. */
export function encryptSecret(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

/** Entschlüsselt; wirft, wenn der Schlüssel nicht passt oder der Wert verändert wurde. */
export function decryptSecret(key: Buffer, value: string): string {
  if (!value.startsWith(PREFIX)) throw new MailKeyError('Unbekanntes Format der gespeicherten Zugangsdaten');
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  if (raw.length < 12 + 16) throw new MailKeyError('Gespeicherte Zugangsdaten sind beschädigt');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  try {
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    throw new MailKeyError('Das Passwort lässt sich nicht entschlüsseln (anderer MAIL_KEY oder neue mail.key?). Bitte das Postfach neu verbinden.');
  }
}
