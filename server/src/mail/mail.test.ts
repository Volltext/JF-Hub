import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../app.js';
import { openDb } from '../db.js';
import { headerChange } from '../collab/testing.js';
import type { PushPayload } from '../push.js';
import { encryptSecret } from './crypto.js';
import { pollMail } from './poller.js';
import { FakeMailBackend } from './testing.js';

const PW = 'ein-sicheres-passwort';
const KEY = Buffer.alloc(32, 9);
const ACCOUNT = { email: 'ich@gmx.de', password: 'richtiges-passwort', displayName: 'Ich', imapHost: 'imap.gmx.net', imapPort: 993, smtpHost: 'mail.gmx.net', smtpPort: 587 };

let db: DatabaseSync;
let app: FastifyInstance;
let fake: FakeMailBackend;
let pushed: PushPayload[];
let admin: string;
let anna: string;

const h = (token: string) => ({ authorization: `Bearer ${token}`, 'x-jfh-schema': '5' });

async function addBetreuer(username: string): Promise<string> {
  const created = await app.inject({ method: 'POST', url: '/api/admin/users', headers: h(admin), payload: { username, displayName: username } });
  const accepted = await app.inject({ method: 'POST', url: '/api/invite/accept', payload: { username, code: created.json().invite.code, password: 'passwort-fuer-betreuer' } });
  return accepted.json().token as string;
}

async function connect(token: string, over: Record<string, unknown> = {}) {
  return app.inject({ method: 'PUT', url: '/api/mail/account', headers: h(token), payload: { ...ACCOUNT, ...over } });
}

beforeEach(async () => {
  db = openDb(':memory:');
  fake = new FakeMailBackend();
  pushed = [];
  app = await buildApp({ db, adminPassword: PW, pushTimer: false, pushSender: async (_s, p) => void pushed.push(p), mail: { key: KEY, backend: fake, pollMs: false } });
  admin = (await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW } })).json().token;
  anna = await addBetreuer('anna');
});
afterEach(async () => {
  await app.close();
});

describe('Postfach verbinden', () => {
  it('ist zunächst aus: kein Konto, keine Ordner', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/mail/account', headers: h(anna) })).json()).toEqual({ account: null });
    const r = await app.inject({ method: 'GET', url: '/api/mail/folders', headers: h(anna) });
    expect(r.statusCode).toBe(404);
  });

  it('prüft die Zugangsdaten und speichert nichts, wenn sie nicht stimmen', async () => {
    const r = await connect(anna, { password: 'falsch' });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toMatch(/Anmeldung beim Postfach ist fehlgeschlagen/);
    expect(r.body).not.toContain('falsch');
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_accounts').get()).toEqual({ n: 0 });
  });

  it('speichert das Passwort nur verschlüsselt und liefert es nie zurück', async () => {
    const r = await connect(anna);
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(ACCOUNT.password);
    const row = db.prepare('SELECT * FROM mail_accounts').get() as { passEnc: string; imapSecure: number; smtpSecure: number; username: string };
    expect(row.passEnc.startsWith('v1:')).toBe(true);
    expect(JSON.stringify(row)).not.toContain(ACCOUNT.password);
    expect(row.imapSecure).toBe(1); // 993 = TLS von Anfang an
    expect(row.smtpSecure).toBe(0); // 587 = STARTTLS
    expect(row.username).toBe('ich@gmx.de'); // ohne Angabe: die Adresse
    const get = (await app.inject({ method: 'GET', url: '/api/mail/account', headers: h(anna) })).json();
    expect(get.account).toMatchObject({ email: 'ich@gmx.de', imapHost: 'imap.gmx.net', notify: true });
    expect(JSON.stringify(get)).not.toMatch(/pass/i);
  });

  it('beim Ändern darf das Passwort leer bleiben (bisheriges gilt)', async () => {
    await connect(anna);
    const r = await connect(anna, { password: '', displayName: 'Anna J.' });
    expect(r.statusCode).toBe(200);
    expect(r.json().account.displayName).toBe('Anna J.');
    expect((await connect(anna, { password: '' })).statusCode).toBe(200);
    // ohne bestehendes Konto ist ein Passwort Pflicht
    expect((await connect(await addBetreuer('ben'), { password: '' })).statusCode).toBe(400);
  });

  it('lehnt ungültige Eingaben ab: Adresse, Ports, Servernamen', async () => {
    for (const over of [{ email: 'nix' }, { imapPort: 22 }, { smtpPort: 3306 }, { imapHost: 'localhost' }, { smtpHost: 'x.de/pfad' }]) {
      const r = await connect(anna, over);
      expect(r.statusCode, JSON.stringify(over)).toBe(400);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_accounts').get()).toEqual({ n: 0 });
  });

  it('meldet einen nicht erreichbaren Server verständlich', async () => {
    fake.down = Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
    const r = await connect(anna);
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toMatch(/nicht erreichbar/);
  });

  it('jeder sieht nur sein eigenes Postfach; Trennen löscht es', async () => {
    const ben = await addBetreuer('ben');
    await connect(anna);
    expect((await app.inject({ method: 'GET', url: '/api/mail/account', headers: h(ben) })).json()).toEqual({ account: null });
    expect((await app.inject({ method: 'GET', url: '/api/mail/folders', headers: h(ben) })).statusCode).toBe(404);
    await app.inject({ method: 'DELETE', url: '/api/mail/account', headers: h(ben) });
    expect((await app.inject({ method: 'GET', url: '/api/mail/account', headers: h(anna) })).json().account).not.toBeNull();
    await app.inject({ method: 'DELETE', url: '/api/mail/account', headers: h(anna) });
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_accounts').get()).toEqual({ n: 0 });
  });

  it('wird mit dem Benutzer gelöscht', async () => {
    await connect(anna);
    const id = (db.prepare("SELECT id FROM users WHERE username = 'anna'").get() as { id: string }).id;
    await app.inject({ method: 'DELETE', url: `/api/admin/users/${id}`, headers: h(admin) });
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_accounts').get()).toEqual({ n: 0 });
  });

  it('meldet, wenn der Schlüssel nicht mehr passt (Postfach neu verbinden)', async () => {
    await connect(anna);
    db.prepare('UPDATE mail_accounts SET passEnc = ?').run(encryptSecret(Buffer.alloc(32, 1), 'x'));
    const r = await app.inject({ method: 'GET', url: '/api/mail/folders', headers: h(anna) });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/neu verbinden/);
  });
});

describe('Mails lesen', () => {
  beforeEach(async () => {
    await connect(anna);
  });

  it('listet Ordner, Mails (neueste zuerst, seitenweise) und sucht', async () => {
    for (let i = 0; i < 35; i++) fake.add();
    const folders = (await app.inject({ method: 'GET', url: '/api/mail/folders', headers: h(anna) })).json().folders;
    expect(folders[0]).toMatchObject({ path: 'INBOX', special: 'inbox', unseen: 35 });
    const p1 = (await app.inject({ method: 'GET', url: '/api/mail/messages?folder=INBOX&page=1', headers: h(anna) })).json();
    expect(p1.total).toBe(35);
    expect(p1.items).toHaveLength(30);
    expect(p1.items[0].uid).toBe(35);
    const p2 = (await app.inject({ method: 'GET', url: '/api/mail/messages?folder=INBOX&page=2', headers: h(anna) })).json();
    expect(p2.items).toHaveLength(5);
    const found = (await app.inject({ method: 'GET', url: '/api/mail/messages?q=Betreff%2012', headers: h(anna) })).json();
    expect(found.items.map((m: { uid: number }) => m.uid)).toEqual([12]);
  });

  it('öffnen markiert als gelesen, außer man bittet darum, es nicht zu tun', async () => {
    const a = fake.add({ text: 'Hallo' });
    const b = fake.add();
    const m = (await app.inject({ method: 'GET', url: `/api/mail/messages/${a}?folder=INBOX`, headers: h(anna) })).json().message;
    expect(m.text).toBe('Hallo');
    expect(fake.messages.find((x) => x.uid === a)!.seen).toBe(true);
    await app.inject({ method: 'GET', url: `/api/mail/messages/${b}?folder=INBOX&keepUnseen=1`, headers: h(anna) });
    expect(fake.messages.find((x) => x.uid === b)!.seen).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/mail/messages/999?folder=INBOX', headers: h(anna) })).statusCode).toBe(404);
  });

  it('lehnt ungültige Ordner und Kennungen ab', async () => {
    for (const url of ['/api/mail/messages/abc', '/api/mail/messages/0', '/api/mail/messages/1?folder=' + encodeURIComponent('a\nb'), '/api/mail/messages/1?folder=' + 'x'.repeat(201)]) {
      expect((await app.inject({ method: 'GET', url, headers: h(anna) })).statusCode, url).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url: '/api/mail/messages?folder=' + encodeURIComponent('a\nb'), headers: h(anna) })).statusCode).toBe(400);
  });

  it('liefert Anhänge nur als Download, nie inline', async () => {
    const uid = fake.add({ attachments: [{ index: 0, filename: 'Plan.html', contentType: 'text/html', size: 20 }], hasAttachments: true, content: { 0: Buffer.from('<script>alert(1)</script>') } });
    const r = await app.inject({ method: 'GET', url: `/api/mail/messages/${uid}/attachments/0?folder=INBOX`, headers: h(anna) });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/octet-stream');
    expect(String(r.headers['content-disposition'])).toMatch(/^attachment; filename\*=UTF-8''Plan\.html/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.body).toContain('alert');
    expect((await app.inject({ method: 'GET', url: `/api/mail/messages/${uid}/attachments/5?folder=INBOX`, headers: h(anna) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/mail/messages/${uid}/attachments/-1?folder=INBOX`, headers: h(anna) })).statusCode).toBe(400);
  });

  it('gelesen/ungelesen und löschen', async () => {
    const uid = fake.add();
    await app.inject({ method: 'POST', url: `/api/mail/messages/${uid}/seen`, headers: h(anna), payload: { folder: 'INBOX', seen: true } });
    expect(fake.messages[0]!.seen).toBe(true);
    await app.inject({ method: 'POST', url: `/api/mail/messages/${uid}/seen`, headers: h(anna), payload: { folder: 'INBOX', seen: false } });
    expect(fake.messages[0]!.seen).toBe(false);
    expect((await app.inject({ method: 'POST', url: `/api/mail/messages/${uid}/seen`, headers: h(anna), payload: { folder: 'INBOX', seen: 'ja' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/mail/messages/${uid}?folder=INBOX`, headers: h(anna) })).statusCode).toBe(200);
    expect(fake.messages).toHaveLength(0);
  });
});

describe('Mails schreiben', () => {
  beforeEach(async () => {
    await connect(anna);
  });
  const send = (token: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/mail/send', headers: h(token), payload });

  it('verschickt Text mit Absender aus dem Postfach', async () => {
    const r = await send(anna, { to: 'Max <max@example.org>, b@example.org', cc: 'c@example.org', subject: 'Dienstplan', text: 'Hallo zusammen' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, savedCopy: true });
    const m = fake.sent[0]!.mail;
    expect(m.from).toEqual({ name: 'Ich', address: 'ich@gmx.de' });
    expect(m.to.map((a) => a.address)).toEqual(['max@example.org', 'b@example.org']);
    expect(m.cc).toHaveLength(1);
    expect(m.subject).toBe('Dienstplan');
  });

  it('der Absender ist immer das eigene Postfach, nie ein mitgeschickter Wert', async () => {
    await send(anna, { to: 'x@example.org', subject: 's', text: 't', from: 'chef@example.org' });
    expect(fake.sent[0]!.mail.from.address).toBe('ich@gmx.de');
  });

  it('verlangt Empfänger, prüft Adressen und begrenzt ihre Zahl', async () => {
    expect((await send(anna, { subject: 's', text: 't' })).statusCode).toBe(400);
    expect((await send(anna, { to: 'kaputt', subject: 's' })).statusCode).toBe(400);
    expect((await send(anna, { to: 'a@example.org\nBcc: x@example.org', subject: 's' })).statusCode).toBe(400);
    const many = Array.from({ length: 31 }, (_, i) => `u${i}@example.org`).join(',');
    expect((await send(anna, { to: many, subject: 's' })).statusCode).toBe(400);
    expect(fake.sent).toHaveLength(0);
  });

  it('schleust über den Betreff keine Kopfzeilen ein', async () => {
    await send(anna, { to: 'a@example.org', subject: 'Hallo\r\nBcc: spion@example.org', text: 't' });
    expect(fake.sent[0]!.mail.subject).not.toMatch(/[\r\n]/);
  });

  it('antwortet mit sauberen Bezugsköpfen (ungültige werden verworfen)', async () => {
    await send(anna, { to: 'a@example.org', subject: 'Re: x', text: 't', inReplyTo: '<abc@example.org>', references: ['<alt@example.org>', 'kein-id', '<x y@z>'] });
    const m = fake.sent[0]!.mail;
    expect(m.inReplyTo).toBe('<abc@example.org>');
    expect(m.references).toEqual(['<alt@example.org>', '<abc@example.org>']);
    await send(anna, { to: 'a@example.org', subject: 'x', text: 't', inReplyTo: 'Bcc: x' });
    expect(fake.sent[1]!.mail.inReplyTo).toBeUndefined();
  });

  it('hängt Dateien an und prüft Größe, Zahl und Inhalt', async () => {
    const file = (name: string, data: string) => ({ name, mime: 'text/plain', data: Buffer.from(data).toString('base64') });
    expect((await send(anna, { to: 'a@example.org', subject: 's', attachments: [file('../../etc/passwd', 'hallo')] })).statusCode).toBe(200);
    expect(fake.sent[0]!.mail.attachments[0]).toMatchObject({ contentType: 'text/plain' });
    expect(fake.sent[0]!.mail.attachments[0]!.filename).not.toMatch(/[/\\]/);
    expect(fake.sent[0]!.mail.attachments[0]!.content.toString()).toBe('hallo');
    expect((await send(anna, { to: 'a@example.org', subject: 's', attachments: [{ name: 'x', mime: 'text/plain', data: '***' }] })).statusCode).toBe(400);
    expect((await send(anna, { to: 'a@example.org', subject: 's', attachments: [{ name: 'x', mime: 'text/plain', data: '' }] })).statusCode).toBe(400);
    const eleven = Array.from({ length: 11 }, (_, i) => file(`f${i}`, 'x'));
    expect((await send(anna, { to: 'a@example.org', subject: 's', attachments: eleven })).statusCode).toBe(400);
    const big = Buffer.alloc(9 * 1024 * 1024, 1).toString('base64');
    const three = [0, 1, 2].map((i) => ({ name: `g${i}`, mime: 'application/pdf', data: big }));
    const r = await send(anna, { to: 'a@example.org', subject: 's', attachments: three });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/20 MB/);
  });

  it('hängt Protokolle als PDF an – nur solche, die der Betreuer sehen darf', async () => {
    const ben = await addBetreuer('ben');
    await connect(ben);
    const sync = (token: string, id: string, shared: boolean) =>
      app.inject({ method: 'POST', url: '/api/sync', headers: h(token), payload: { since: 0, protocols: [headerChange(id, { title: 'Übung im Wald', shared })], records: [] } });
    await sync(anna, 'p-privat', false);
    await sync(anna, 'p-offen', true);

    const ok = await send(anna, { to: 'a@example.org', subject: 'Protokoll', protocolIds: ['p-privat', 'p-offen'] });
    expect(ok.statusCode).toBe(200);
    const att = fake.sent[0]!.mail.attachments;
    expect(att.map((a) => a.contentType)).toEqual(['application/pdf', 'application/pdf']);
    expect(att[0]!.content.subarray(0, 4).toString()).toBe('%PDF');
    expect(att[0]!.filename).toMatch(/Übung im Wald\.pdf$/);
    expect(att[1]!.filename).toMatch(/\(2\)\.pdf$/); // gleicher Name: nummeriert

    // Ben darf das private Protokoll von Anna weder sehen noch verschicken, das offene schon.
    const denied = await send(ben, { to: 'a@example.org', subject: 'x', protocolIds: ['p-privat'] });
    expect(denied.statusCode).toBe(400);
    expect(denied.json().error).toMatch(/nicht gefunden|darf nicht/);
    expect((await send(anna, { to: 'a@example.org', subject: 'x', protocolIds: ['gibt-es-nicht'] })).statusCode).toBe(400);
    // Ben darf das offene verschicken
    expect((await send(ben, { to: 'a@example.org', subject: 'x', protocolIds: ['p-offen'] })).statusCode).toBe(200);
    expect(fake.sent).toHaveLength(2);
  });
});

describe('ausgeschaltet und Demo', () => {
  it('ohne Schlüssel oder mit MAIL_ENABLED=0 antworten die Routen 404 und die Funktion wird nicht angekündigt', async () => {
    const off = await buildApp({ db: openDb(':memory:'), adminPassword: PW, pushTimer: false, mail: { key: KEY, enabled: false, backend: fake } });
    const none = await buildApp({ db: openDb(':memory:'), adminPassword: PW, pushTimer: false });
    for (const a of [off, none]) {
      const t = (await a.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW } })).json().token;
      expect((await a.inject({ method: 'GET', url: '/api/mail/account', headers: h(t) })).statusCode).toBe(404);
      expect((await a.inject({ method: 'GET', url: '/api/status' })).json().features).not.toContain('mail');
      await a.close();
    }
    expect((await app.inject({ method: 'GET', url: '/api/status' })).json().features).toContain('mail');
  });

  it('in der öffentlichen Demo gesperrt', async () => {
    const demo = await buildApp({ db: openDb(':memory:'), pushTimer: false, demo: { timer: false }, mail: { key: KEY, backend: fake } });
    const t = (await demo.inject({ method: 'POST', url: '/api/login', payload: { username: 'demo', password: 'demo' } })).json().token as string | undefined;
    const login = t ?? '';
    const r = await demo.inject({ method: 'PUT', url: '/api/mail/account', headers: h(login), payload: ACCOUNT });
    expect([401, 403]).toContain(r.statusCode);
    expect(fake.calls).toHaveLength(0);
    await demo.close();
  });
});

describe('Benachrichtigung bei neuen Mails', () => {
  const device = (token: string, n = 1) =>
    app.inject({ method: 'POST', url: '/api/push/subscribe', headers: h(token), payload: { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/dev${n}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } }, device: 'Test' } });
  const poll = (now?: number) => pollMail(db, KEY, fake, async (_s, p) => void pushed.push(p), now);

  beforeEach(async () => {
    await connect(anna);
    await device(anna);
  });

  it('meldet beim ersten Mal nichts (kein Fluten mit dem ungelesenen Bestand), danach nur Neues', async () => {
    fake.add();
    fake.add();
    await poll();
    expect(pushed).toHaveLength(0);
    fake.add({ from: { name: 'Bernd Chef', address: 'b@example.org' }, subject: 'Zeltlager' });
    const res = await poll();
    expect(res.notified).toBe(1);
    expect(pushed).toEqual([{ title: 'Bernd Chef', body: 'Zeltlager', url: '/mail/m/INBOX/3', tag: 'mail:3' }]);
    await poll();
    expect(pushed).toHaveLength(1); // nicht noch einmal
  });

  it('bereits gelesene Mails lösen nichts aus; viele neue werden zusammengefasst', async () => {
    await poll();
    fake.add({ seen: true });
    await poll();
    expect(pushed).toHaveLength(0);
    for (let i = 0; i < 5; i++) fake.add();
    await poll();
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.title).toBe('5 neue Mails');
    expect(pushed[0]!.url).toBe('/mail');
  });

  it('bei neuer UIDVALIDITY (Posteingang neu aufgebaut) wird neu begonnen statt alles zu melden', async () => {
    fake.add();
    await poll();
    fake.uidValidity = 2;
    fake.add();
    await poll();
    expect(pushed).toHaveLength(0);
    fake.add();
    await poll();
    expect(pushed).toHaveLength(1);
  });

  it('nach langer Pause wird nicht nachgemeldet', async () => {
    const t0 = Date.now();
    await poll(t0);
    fake.add();
    fake.add();
    await poll(t0 + 3 * 86_400_000);
    expect(pushed).toHaveLength(0);
  });

  it('ohne angemeldetes Gerät oder mit ausgeschalteter Benachrichtigung wird gar nicht erst verbunden', async () => {
    fake.calls.length = 0;
    const ben = await addBetreuer('ben');
    await connect(ben); // Ben hat kein Gerät
    fake.calls.length = 0;
    await app.inject({ method: 'PATCH', url: '/api/mail/account', headers: h(anna), payload: { notify: false } });
    await poll();
    expect(fake.calls).toHaveLength(0);
    await app.inject({ method: 'PATCH', url: '/api/mail/account', headers: h(anna), payload: { notify: true } });
    await poll();
    expect(fake.calls).toHaveLength(1);
  });

  it('merkt sich Fehler (falsches Passwort), zeigt sie an und prüft danach seltener', async () => {
    fake.password = 'geaendert';
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) await poll(t0 + i * 1000);
    const row = db.prepare('SELECT failures, lastError FROM mail_accounts').get() as { failures: number; lastError: string };
    expect(row.failures).toBe(5);
    expect(row.lastError).toMatch(/Anmeldung/);
    expect((await app.inject({ method: 'GET', url: '/api/mail/account', headers: h(anna) })).json().account.lastError).toMatch(/Anmeldung/);
    fake.calls.length = 0;
    await poll(t0 + 10_000);
    expect(fake.calls).toHaveLength(0); // erst nach einer Stunde wieder
    fake.password = 'richtiges-passwort';
    await poll(t0 + 3_700_000);
    expect(db.prepare('SELECT failures FROM mail_accounts').get()).toEqual({ failures: 0 });
  });

  it('Passwort ändern setzt den Ausgangspunkt zurück', async () => {
    fake.add();
    await poll();
    expect((db.prepare('SELECT lastUid FROM mail_accounts').get() as { lastUid: number }).lastUid).toBe(1);
    await connect(anna, { password: '' });
    expect(db.prepare('SELECT lastUid FROM mail_accounts').get()).toEqual({ lastUid: null });
  });
});
