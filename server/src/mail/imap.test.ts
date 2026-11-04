import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import type { AddressInfo } from 'node:net';
import { friendlyMailError } from './errors.js';
import { ImapBackend, structureHasAttachments } from './imap.js';
import type { MailConnection } from './types.js';

let server: SMTPServer;
let port: number;
let received: Buffer[];
let envelopes: { from: string; to: string[] }[];

beforeEach(async () => {
  received = [];
  envelopes = [];
  server = new SMTPServer({
    secure: true,
    authOptional: false,
    logger: false,
    onAuth(auth, _session, cb) {
      if (auth.username === 'ich@gmx.de' && auth.password === 'richtig') cb(null, { user: 1 });
      else cb(Object.assign(new Error('Invalid login'), { responseCode: 535 }));
    },
    onMailFrom(address, _s, cb) {
      envelopes.push({ from: address.address, to: [] });
      cb();
    },
    onRcptTo(address, _s, cb) {
      envelopes.at(-1)!.to.push(address.address);
      cb();
    },
    onData(stream, _s, cb) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        received.push(Buffer.concat(chunks));
        cb();
      });
    },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  port = (server.server.address() as AddressInfo).port;
});
afterEach(async () => {
  await new Promise<void>((ok) => server.close(() => ok()));
});

const conn = (over: Partial<MailConnection> = {}): MailConnection => ({
  email: 'ich@gmx.de',
  username: 'ich@gmx.de',
  password: 'richtig',
  imapHost: '127.0.0.1',
  imapPort: 1, // bewusst nichts: die Kopie in „Gesendet“ ist optional
  imapSecure: true,
  smtpHost: '127.0.0.1',
  smtpPort: port,
  smtpSecure: true,
  ...over,
});

const backend = () => new ImapBackend({ allowPrivate: true, tls: { rejectUnauthorized: false } });

describe('Versand per SMTP (gegen einen lokalen Testserver)', () => {
  it('verschickt Text und Anhänge, auch ein PDF, und liefert die Nachrichten-ID', async () => {
    const pdf = Buffer.from('%PDF-1.4 test');
    const res = await backend().send(conn(), {
      from: { name: 'Anna Ä', address: 'ich@gmx.de' },
      to: [{ name: 'Max Müller', address: 'max@example.org' }],
      cc: [{ name: '', address: 'cc@example.org' }],
      subject: 'Protokoll vom Dienstag – Übung',
      text: 'Hallo Max,\nanbei das Protokoll.\n',
      inReplyTo: '<alt@example.org>',
      references: ['<alt@example.org>'],
      attachments: [{ filename: 'Protokoll 2026-11-03.pdf', contentType: 'application/pdf', content: pdf }],
    });
    expect(res.messageId).toMatch(/^<.+>$/);
    expect(res.saved).toBe(false); // IMAP war nicht erreichbar: die Mail ging trotzdem raus
    expect(envelopes[0]).toEqual({ from: 'ich@gmx.de', to: ['max@example.org', 'cc@example.org'] });
    const mail = await simpleParser(received[0]!);
    expect(mail.subject).toBe('Protokoll vom Dienstag – Übung');
    expect(mail.text).toContain('anbei das Protokoll');
    expect(mail.from?.value[0]).toMatchObject({ address: 'ich@gmx.de', name: 'Anna Ä' });
    expect(mail.inReplyTo).toBe('<alt@example.org>');
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0]).toMatchObject({ filename: 'Protokoll 2026-11-03.pdf', contentType: 'application/pdf' });
    expect(mail.attachments[0]!.content.equals(pdf)).toBe(true);
  });

  it('Bcc-Empfänger gibt es nicht: nur To und Cc kommen in den Umschlag', async () => {
    await backend().send(conn(), { from: { name: '', address: 'ich@gmx.de' }, to: [{ name: '', address: 'a@example.org' }], cc: [], subject: 's', text: 't', attachments: [] });
    expect(envelopes[0]!.to).toEqual(['a@example.org']);
  });

  it('falsches Passwort ergibt die verständliche Anmeldemeldung', async () => {
    const err = await backend().send(conn({ password: 'falsch' }), { from: { name: '', address: 'ich@gmx.de' }, to: [{ name: '', address: 'a@example.org' }], cc: [], subject: 's', text: 't', attachments: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    const f = friendlyMailError(err);
    expect(f.message).toMatch(/Anmeldung beim Postfach ist fehlgeschlagen/);
    expect(f.message).not.toContain('falsch');
    expect(received).toHaveLength(0);
  });

  it('test() meldet einen nicht erreichbaren Server verständlich', async () => {
    const err = await backend().test(conn({ imapPort: 1 })).catch((e) => e);
    expect(friendlyMailError(err).message).toMatch(/nicht erreichbar/);
  });
});

describe('Schutz vor Zugriffen auf das interne Netz', () => {
  it('verbindet sich nie mit internen Adressen, solange es nicht ausdrücklich erlaubt ist', async () => {
    const strict = new ImapBackend();
    for (const host of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '192.168.178.1']) {
      const err = await strict.test(conn({ imapHost: host, smtpHost: host })).catch((e) => e);
      expect(friendlyMailError(err).message, host).toMatch(/internen Netz/);
    }
    expect(received).toHaveLength(0);
    // auch beim Senden
    const err = await strict.send(conn(), { from: { name: '', address: 'ich@gmx.de' }, to: [{ name: '', address: 'a@example.org' }], cc: [], subject: 's', text: 't', attachments: [] }).catch((e) => e);
    expect(friendlyMailError(err).message).toMatch(/internen Netz/);
  });
});

describe('structureHasAttachments', () => {
  it('erkennt Anhänge im Aufbau der Mail, nicht aber Textteile und eingebettete Bilder', () => {
    expect(structureHasAttachments(undefined)).toBe(false);
    expect(structureHasAttachments({ type: 'text/plain' })).toBe(false);
    expect(structureHasAttachments({ type: 'multipart/related', childNodes: [{ type: 'text/html' }, { type: 'image/png', disposition: 'inline', dispositionParameters: { filename: 'logo.png' } }] })).toBe(false);
    expect(structureHasAttachments({ type: 'multipart/mixed', childNodes: [{ type: 'text/plain' }, { type: 'application/pdf', disposition: 'attachment' }] })).toBe(true);
    expect(structureHasAttachments({ type: 'multipart/mixed', childNodes: [{ type: 'multipart/alternative', childNodes: [{ type: 'text/plain' }] }, { type: 'application/zip', disposition: 'inline', dispositionParameters: { filename: 'a.zip' } }] })).toBe(true);
  });
});
