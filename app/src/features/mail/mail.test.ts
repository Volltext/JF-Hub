import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/core/db/db';
import type { MailMessage } from './api';
import { addressList, buildForward, buildProtocolMail, buildReply, formatAddress, forwardSubject, looksLikeEmail, quote, replySubject, shortAddress } from './compose';
import { CUSTOM, PROVIDERS, guessProvider, providerFor } from './providers';
import { attachmentBlocks, docFromMail, isoDay, textBlocks } from './toProtocol';
import { taskFromMail } from './toTask';

const attachments = vi.hoisted(() => ({ b64: '' }));
vi.mock('./api', async () => ({ mailApi: { attachment: async () => attachments.b64 } }));
vi.mock('@/features/protokolle/sync', () => ({ scheduleSync: vi.fn(), syncNow: vi.fn() }));
vi.mock('@/features/protokolle/http', () => ({ loadConn: async () => ({ url: '', token: null }), request: vi.fn(), ProtoError: class extends Error {} }));
import { createProtocolFromMail, placeAttachment, queueForProtocol, takePending } from './actions';

const msg = (over: Partial<MailMessage> = {}): MailMessage => ({
  uid: 7,
  from: { name: 'Anna Beispiel', address: 'anna@example.org' },
  to: [{ name: '', address: 'ich@gmx.de' }, { name: 'Ben', address: 'ben@example.org' }],
  cc: [{ name: '', address: 'cara@example.org' }],
  replyTo: [],
  subject: 'Zeltlager 2027',
  date: new Date(2026, 10, 3, 14, 30).toISOString(),
  seen: false,
  hasAttachments: false,
  messageId: '<abc@example.org>',
  references: ['<alt@example.org>'],
  text: 'Hallo,\n\nkönnt ihr den Bus buchen?\nDanke',
  fromHtml: false,
  attachments: [],
  ...over,
});

describe('Anbieter', () => {
  it('erkennt GMX und andere an der Domain', () => {
    expect(guessProvider('max@gmx.de')?.id).toBe('gmx');
    expect(guessProvider(' Max@GMX.NET ')?.id).toBe('gmx');
    expect(guessProvider('x@web.de')?.id).toBe('webde');
    expect(guessProvider('x@verein-xy.de')).toBeUndefined();
    expect(guessProvider('kein-at')).toBeUndefined();
  });

  it('alle Voreinstellungen nutzen erlaubte Ports und vollständige Namen', () => {
    for (const p of PROVIDERS) {
      expect([143, 993]).toContain(p.imapPort);
      expect([25, 465, 587, 2525]).toContain(p.smtpPort);
      expect(p.imapHost).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      expect(p.smtpHost).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      expect(p.hint.length).toBeGreaterThan(10);
    }
    expect(PROVIDERS.find((p) => p.id === 'gmx')).toMatchObject({ imapHost: 'imap.gmx.net', smtpHost: 'mail.gmx.net' });
  });

  it('ordnet gespeicherte Server der Voreinstellung zu, sonst „anderer Anbieter“', () => {
    expect(providerFor('imap.gmx.net', 'mail.gmx.net').id).toBe('gmx');
    expect(providerFor('imap.verein.de', 'smtp.verein.de')).toBe(CUSTOM);
  });
});

describe('Adressen und Betreff', () => {
  it('formatiert Adressen (Namen mit Komma in Anführungszeichen)', () => {
    expect(formatAddress({ name: '', address: 'a@x.de' })).toBe('a@x.de');
    expect(formatAddress({ name: 'Anna', address: 'a@x.de' })).toBe('Anna <a@x.de>');
    expect(formatAddress({ name: 'Müller, Anna', address: 'a@x.de' })).toBe('"Müller, Anna" <a@x.de>');
    expect(addressList([{ name: 'A', address: 'a@x.de' }, { name: '', address: 'b@x.de' }])).toBe('A <a@x.de>, b@x.de');
    expect(shortAddress({ name: ' ', address: 'a@x.de' })).toBe('a@x.de');
    expect(shortAddress(null)).toBe('Unbekannt');
  });

  it('Betreffzeilen und Zitat', () => {
    expect(replySubject('Hallo')).toBe('Re: Hallo');
    expect(replySubject('AW: Hallo')).toBe('AW: Hallo');
    expect(forwardSubject('Hallo')).toBe('Fwd: Hallo');
    expect(forwardSubject('WG: Hallo')).toBe('WG: Hallo');
    expect(quote('a\n\nb\r\n')).toBe('> a\n>\n> b');
  });

  it('grobe Adressprüfung', () => {
    expect(looksLikeEmail('a@b.de')).toBe(true);
    for (const bad of ['', 'a@b', 'a b@c.de', '@c.de']) expect(looksLikeEmail(bad), bad).toBe(false);
  });
});

describe('Antworten und Weiterleiten', () => {
  it('antwortet an den Absender, zitiert und setzt Bezugsköpfe', () => {
    const d = buildReply(msg(), { all: false, me: 'ich@gmx.de' });
    expect(d.to).toBe('Anna Beispiel <anna@example.org>');
    expect(d.cc).toBe('');
    expect(d.subject).toBe('Re: Zeltlager 2027');
    expect(d.text).toContain('Am 03.11.2026, 14:30 schrieb Anna Beispiel <anna@example.org>:');
    expect(d.text).toContain('> könnt ihr den Bus buchen?');
    expect(d.text.startsWith('\n\n')).toBe(true); // Platz zum Schreiben vor dem Zitat
    expect(d.inReplyTo).toBe('<abc@example.org>');
    expect(d.references).toEqual(['<alt@example.org>', '<abc@example.org>']);
  });

  it('„Allen antworten“ nimmt die anderen mit, nie die eigene Adresse und keine doppelten', () => {
    const d = buildReply(msg({ cc: [{ name: '', address: 'ICH@gmx.de' }, { name: '', address: 'anna@example.org' }, { name: '', address: 'cara@example.org' }] }), { all: true, me: 'ich@gmx.de' });
    expect(d.to).toBe('Anna Beispiel <anna@example.org>');
    expect(d.cc).toBe('Ben <ben@example.org>, cara@example.org');
  });

  it('Reply-To geht vor; schrieb man selbst, geht die Antwort an den ersten Empfänger', () => {
    expect(buildReply(msg({ replyTo: [{ name: 'Verteiler', address: 'liste@example.org' }] }), { all: false, me: 'ich@gmx.de' }).to).toBe('Verteiler <liste@example.org>');
    const own = buildReply(msg({ from: { name: 'Ich', address: 'ich@gmx.de' }, to: [{ name: '', address: 'ben@example.org' }] }), { all: false, me: 'ich@gmx.de' });
    expect(own.to).toBe('ben@example.org');
  });

  it('Weiterleiten übernimmt Kopfzeilen und Text, ohne Empfänger', () => {
    const d = buildForward(msg());
    expect(d.to).toBe('');
    expect(d.subject).toBe('Fwd: Zeltlager 2027');
    expect(d.text).toContain('Von: Anna Beispiel <anna@example.org>');
    expect(d.text).toContain('Cc: cara@example.org');
    expect(d.text).toContain('könnt ihr den Bus buchen?');
    expect(d.inReplyTo).toBeUndefined();
  });

  it('Mail mit Protokoll: Betreff mit Datum und Titel', () => {
    expect(buildProtocolMail('Übung im Wald', '2026-11-03').subject).toBe('Protokoll vom 03.11.2026: Übung im Wald');
    expect(buildProtocolMail('', '').subject).toBe('Protokoll');
  });
});

describe('Aufgabe aus Mail', () => {
  it('nimmt Betreff, Absender, Datum und den Anfang des Textes', () => {
    const t = taskFromMail(msg(), '2026-11-10');
    expect(t.title).toBe('Zeltlager 2027');
    expect(t.dueDate).toBe('2026-11-10');
    expect(t.description).toBe('Mail von Anna Beispiel vom 03.11.2026, 14:30: Hallo, könnt ihr den Bus buchen? Danke');
    expect(t).toMatchObject({ priority: 'medium', sessionId: null });
  });

  it('kürzt lange Texte, ersetzt einen leeren Betreff und kommt ohne Text aus', () => {
    expect(taskFromMail(msg({ text: 'x'.repeat(1000) }), null).description.length).toBeLessThan(450);
    expect(taskFromMail(msg({ subject: '  ' }), null).title).toBe('Mail von Anna Beispiel');
    expect(taskFromMail(msg({ text: '' }), null).description).toBe('Mail von Anna Beispiel vom 03.11.2026, 14:30');
  });
});

describe('Protokoll aus Mail: Inhalt', () => {
  it('baut Kopf, Text und Anhänge im Vokabular des Editors', () => {
    const doc = docFromMail(msg(), [
      { blobId: 'b1', name: 'Plan.pdf', mime: 'application/pdf', size: 1234 },
      { blobId: 'b2', name: 'x.jpg', mime: 'image/jpeg', size: 10, photo: { w: 800, h: 600 } },
    ]);
    expect(doc.type).toBe('doc');
    expect(doc.content![0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'Mail von Anna Beispiel vom 03.11.2026, 14:30' }] });
    const types = doc.content!.map((n) => n.type);
    expect(types).toContain('attachment');
    expect(types).toContain('photo');
    expect(doc.content!.find((n) => n.type === 'attachment')!.attrs).toEqual({ blobId: 'b1', name: 'Plan.pdf', mime: 'application/pdf', size: 1234 });
    expect(doc.content!.find((n) => n.type === 'photo')!.attrs).toEqual({ blobId: 'b2', mime: 'image/jpeg', w: 800, h: 600, caption: '' });
    // nur Absätze, Fotos und Dateien: nichts, was der Editor nicht kennt
    expect(new Set(types)).toEqual(new Set(['paragraph', 'attachment', 'photo']));
  });

  it('Text als Absätze, nie ein leerer Text-Knoten (den der Editor ablehnt)', () => {
    const blocks = textBlocks('a\n\nb');
    expect(blocks).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }, { type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: 'b' }] }]);
    expect(textBlocks('')).toEqual([{ type: 'paragraph' }]);
    expect(attachmentBlocks([])).toEqual([]);
  });

  it('Datum der Mail als Tag, sonst Ersatz', () => {
    expect(isoDay(new Date(2026, 10, 3, 23, 59).toISOString(), 'x')).toBe('2026-11-03');
    expect(isoDay('', '2026-01-01')).toBe('2026-01-01');
  });
});

describe('Anhänge und Protokolle ablegen', () => {
  beforeEach(async () => {
    await Promise.all([db.protokolle.clear(), db.blobs.clear(), db.blobData.clear(), db.kv.clear()]);
  });

  it('legt eine Datei als lokalen Anhang ab (Upload folgt mit dem Abgleich)', async () => {
    attachments.b64 = btoa('Inhalt der Datei');
    const placed = await placeAttachment('INBOX', 7, { index: 0, filename: 'Plan.pdf', contentType: 'application/pdf', size: 16 });
    expect(placed).toMatchObject({ name: 'Plan.pdf', mime: 'application/pdf', size: 16 });
    expect(placed.photo).toBeUndefined();
    const meta = await db.blobs.get(placed.blobId);
    expect(meta).toMatchObject({ kind: 'file', state: 'local', name: 'Plan.pdf' });
    expect(new TextDecoder().decode((await db.blobData.get(placed.blobId))!.data)).toBe('Inhalt der Datei');
  });

  it('lehnt zu große und leere Anhänge mit dem Dateinamen ab', async () => {
    await expect(placeAttachment('INBOX', 7, { index: 0, filename: 'riesig.zip', contentType: 'application/zip', size: 11 * 1024 * 1024 })).rejects.toThrow(/riesig\.zip.*größer/);
    attachments.b64 = '';
    await expect(placeAttachment('INBOX', 7, { index: 0, filename: 'leer.txt', contentType: 'text/plain', size: 5 })).rejects.toThrow(/leer\.txt.*leer/);
  });

  it('neues Protokoll aus der Mail: Titel, Tag der Mail, Inhalt mit Verweis auf den Anhang', async () => {
    const id = await createProtocolFromMail(msg(), [{ blobId: 'blob-1', name: 'Plan.pdf', mime: 'application/pdf', size: 3 }]);
    const p = (await db.protokolle.get(id))!;
    expect(p).toMatchObject({ title: 'Zeltlager 2027', datum: '2026-11-03', rev: 0, dirty: 1, deleted: 0 });
    expect(JSON.stringify(p.content)).toContain('blob-1');
    expect(JSON.stringify(p.content)).toContain('könnt ihr den Bus buchen?');
  });

  it('vorgemerkte Anhänge für ein vorhandenes Protokoll gibt es genau einmal', async () => {
    const a = { blobId: 'b1', name: 'a.pdf', mime: 'application/pdf', size: 1 };
    const b = { blobId: 'b2', name: 'b.pdf', mime: 'application/pdf', size: 2 };
    expect(await takePending('p1')).toEqual([]);
    await queueForProtocol('p1', [a]);
    await queueForProtocol('p1', [b]);
    await queueForProtocol('p2', []);
    expect(await takePending('p1')).toEqual([a, b]);
    expect(await takePending('p1')).toEqual([]);
    expect(await takePending('p2')).toEqual([]);
  });
});
