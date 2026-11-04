import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { decodeBase64, cleanMime, cleanName, MAX_FILE_BYTES } from '../blobs.js';
import type { SessionUser } from '../auth.js';
import { friendlyMailError } from './errors.js';
import { MailInputError } from './errors.js';
import { deleteAccount, getAccount, parseAccountInput, publicAccount, saveAccount, setNotify, toConnection } from './store.js';
import { decryptSecret } from './crypto.js';
import { oneLine, parseAddressList } from './text.js';
import type { MailBackend, OutgoingAttachment } from './types.js';

export const MAX_ATTACHMENTS = 10;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_PROTOCOLS = 5;
const MAX_TEXT = 500_000;

export interface MailRoutesDeps {
  db: DatabaseSync;
  key: Buffer;
  backend: MailBackend;
  /** Angemeldeter Betreuer der Anfrage. */
  me: (req: FastifyRequest) => SessionUser;
  /** Knappe Zusatzgrenze je Route (wie in app.ts). */
  limited: (max: number, timeWindow?: string) => object;
  /** PDF eines Protokolls im Layout des Vereins; `undefined`, wenn es fehlt oder der Betreuer es nicht sehen darf. */
  protocolPdf: (id: string, user: SessionUser) => Promise<{ filename: string; content: Buffer } | undefined>;
  enabled: boolean;
}

const FOLDER_RE = /^[^\u0000-\u001f\u007f]{1,200}$/;

/** Mail-Routen. Alle brauchen eine Anmeldung (der Haken in app.ts prüft alles unter /api/ außer den öffentlichen Routen). */
export function registerMailRoutes(app: FastifyInstance, d: MailRoutesDeps): void {
  const { db, key, backend } = d;

  const guard = async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!d.enabled) return reply.code(404).send({ error: 'E-Mail ist auf diesem Server ausgeschaltet.' });
  };
  const opt = (extra: object = {}) => ({ preHandler: guard, ...extra });

  const fail = (reply: FastifyReply, e: unknown) => {
    const f = friendlyMailError(e);
    return reply.code(f.status).send({ error: f.message });
  };

  /** Verbindungsdaten des angemeldeten Betreuers; sendet selbst die Antwort, wenn es kein Postfach gibt oder das Passwort nicht entschlüsselt werden kann. */
  const conn = (req: FastifyRequest, reply: FastifyReply) => {
    const row = getAccount(db, d.me(req).id);
    if (!row) {
      void reply.code(404).send({ error: 'Es ist noch kein Postfach eingerichtet.' });
      return undefined;
    }
    try {
      return { row, c: toConnection(key, row) };
    } catch (e) {
      void fail(reply, e);
      return undefined;
    }
  };

  const folderOf = (v: unknown): string | undefined => (typeof v === 'string' && FOLDER_RE.test(v) ? v : undefined);
  const uidOf = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 && n < 2 ** 32 ? n : undefined;
  };

  // ---------- Konto ----------
  app.get('/api/mail/account', opt(), async (req) => {
    const row = getAccount(db, d.me(req).id);
    return { account: row ? publicAccount(row) : null };
  });

  /** Prüft die Zugangsdaten gegen den Mail-Server und speichert sie nur, wenn das klappt. */
  app.put<{ Body: unknown }>('/api/mail/account', opt(d.limited(10)), async (req, reply) => {
    const user = d.me(req);
    try {
      const old = getAccount(db, user.id);
      const input = parseAccountInput(req.body, old ? { password: decryptSecret(key, old.passEnc) } : undefined);
      await backend.test({ ...input });
      saveAccount(db, key, user.id, input);
      return { ok: true, account: publicAccount(getAccount(db, user.id)!) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.patch<{ Body: { notify?: unknown } }>('/api/mail/account', opt(), async (req, reply) => {
    if (typeof req.body?.notify !== 'boolean') return reply.code(400).send({ error: 'Ungültige Anfrage' });
    if (!setNotify(db, d.me(req).id, req.body.notify)) return reply.code(404).send({ error: 'Es ist noch kein Postfach eingerichtet.' });
    return { ok: true };
  });

  app.delete('/api/mail/account', opt(), async (req) => ({ ok: true, removed: deleteAccount(db, d.me(req).id) }));

  // ---------- Lesen ----------
  app.get('/api/mail/folders', opt(d.limited(120)), async (req, reply) => {
    const x = conn(req, reply);
    if (!x) return;
    try {
      return { folders: await backend.folders(x.c) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get<{ Querystring: { folder?: string; page?: string; q?: string } }>('/api/mail/messages', opt(d.limited(240)), async (req, reply) => {
    const folder = folderOf(req.query.folder ?? 'INBOX');
    if (!folder) return reply.code(400).send({ error: 'Ungültiger Ordner' });
    const page = Math.min(500, Math.max(1, Math.floor(Number(req.query.page) || 1)));
    const query = oneLine(String(req.query.q ?? '')).slice(0, 100);
    const x = conn(req, reply);
    if (!x) return;
    try {
      const res = await backend.list(x.c, folder, { page, pageSize: 30, query: query || undefined });
      return { folder, page, pageSize: 30, ...res };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get<{ Params: { uid: string }; Querystring: { folder?: string; keepUnseen?: string } }>('/api/mail/messages/:uid', opt(d.limited(240)), async (req, reply) => {
    const folder = folderOf(req.query.folder ?? 'INBOX');
    const uid = uidOf(req.params.uid);
    if (!folder || !uid) return reply.code(400).send({ error: 'Ungültige Anfrage' });
    const x = conn(req, reply);
    if (!x) return;
    try {
      const msg = await backend.get(x.c, folder, uid, req.query.keepUnseen !== '1');
      return msg ? { message: msg } : reply.code(404).send({ error: 'Diese Mail gibt es nicht mehr.' });
    } catch (e) {
      return fail(reply, e);
    }
  });

  /** Anhang einer Mail. Nie inline ausgeliefert (kein Ausführen hochgeladener Seiten), wie bei den Anhängen der Protokolle. */
  app.get<{ Params: { uid: string; index: string }; Querystring: { folder?: string } }>('/api/mail/messages/:uid/attachments/:index', opt(d.limited(120)), async (req, reply) => {
    const folder = folderOf(req.query.folder ?? 'INBOX');
    const uid = uidOf(req.params.uid);
    const index = Number(req.params.index);
    if (!folder || !uid || !Number.isInteger(index) || index < 0 || index > 200) return reply.code(400).send({ error: 'Ungültige Anfrage' });
    const x = conn(req, reply);
    if (!x) return;
    try {
      const a = await backend.attachment(x.c, folder, uid, index);
      if (!a) return reply.code(404).send({ error: 'Diesen Anhang gibt es nicht.' });
      const name = cleanName(a.filename) || 'Anhang';
      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
        .header('X-JFH-Mime', cleanMime(a.contentType))
        .send(a.content);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Params: { uid: string }; Body: { folder?: string; seen?: unknown } }>('/api/mail/messages/:uid/seen', opt(d.limited(240)), async (req, reply) => {
    const folder = folderOf(req.body?.folder ?? 'INBOX');
    const uid = uidOf(req.params.uid);
    if (!folder || !uid || typeof req.body?.seen !== 'boolean') return reply.code(400).send({ error: 'Ungültige Anfrage' });
    const x = conn(req, reply);
    if (!x) return;
    try {
      await backend.setSeen(x.c, folder, uid, req.body.seen);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete<{ Params: { uid: string }; Querystring: { folder?: string } }>('/api/mail/messages/:uid', opt(d.limited(120)), async (req, reply) => {
    const folder = folderOf(req.query.folder ?? 'INBOX');
    const uid = uidOf(req.params.uid);
    if (!folder || !uid) return reply.code(400).send({ error: 'Ungültige Anfrage' });
    const x = conn(req, reply);
    if (!x) return;
    try {
      await backend.remove(x.c, folder, uid);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ---------- Schreiben ----------
  interface SendBody {
    to?: unknown;
    cc?: unknown;
    subject?: unknown;
    text?: unknown;
    inReplyTo?: unknown;
    references?: unknown;
    /** Protokolle, die als PDF (im Layout des Vereins) angehängt werden. */
    protocolIds?: unknown;
    attachments?: unknown;
  }

  app.post<{ Body: SendBody }>('/api/mail/send', opt({ bodyLimit: 40 * 1024 * 1024, ...d.limited(20) }), async (req, reply) => {
    const x = conn(req, reply);
    if (!x) return;
    const b = (req.body ?? {}) as SendBody;
    try {
      const to = parseAddressList(b.to);
      const cc = parseAddressList(b.cc);
      if (to.length === 0) throw new MailInputError('Bitte mindestens einen Empfänger eintragen.');
      if (to.length + cc.length > 30) throw new MailInputError('Zu viele Empfänger (höchstens 30).');
      const subject = oneLine(String(b.subject ?? '')).slice(0, 300);
      const text = String(b.text ?? '');
      if (text.length > MAX_TEXT) throw new MailInputError('Der Text ist zu lang.');

      const attachments: OutgoingAttachment[] = [];
      let total = 0;
      const files = Array.isArray(b.attachments) ? b.attachments : [];
      if (files.length > MAX_ATTACHMENTS) throw new MailInputError(`Zu viele Anhänge (höchstens ${MAX_ATTACHMENTS}).`);
      for (const f of files as { name?: unknown; mime?: unknown; data?: unknown }[]) {
        const content = typeof f?.data === 'string' ? decodeBase64(f.data) : null;
        if (!content || content.length === 0) throw new MailInputError('Ein Anhang ist leer oder ungültig.');
        if (content.length > MAX_FILE_BYTES) throw new MailInputError('Ein Anhang ist größer als 10 MB.');
        total += content.length;
        attachments.push({ filename: cleanName(f.name) || 'Anhang', contentType: cleanMime(f.mime), content });
      }
      const ids = Array.isArray(b.protocolIds) ? [...new Set(b.protocolIds.map(String))] : [];
      if (ids.length > MAX_PROTOCOLS) throw new MailInputError(`Höchstens ${MAX_PROTOCOLS} Protokolle auf einmal.`);
      const names = new Set<string>();
      for (const id of ids) {
        const pdf = await d.protocolPdf(id, d.me(req));
        if (!pdf) throw new MailInputError('Ein Protokoll wurde nicht gefunden oder darf nicht verschickt werden.');
        total += pdf.content.length;
        let filename = `${pdf.filename}.pdf`;
        for (let n = 2; names.has(filename); n++) filename = `${pdf.filename} (${n}).pdf`;
        names.add(filename);
        attachments.push({ filename, contentType: 'application/pdf', content: pdf.content });
      }
      if (total > MAX_TOTAL_BYTES) throw new MailInputError('Die Anhänge sind zusammen größer als 20 MB.');

      const references = (Array.isArray(b.references) ? b.references : []).map((r) => oneLine(String(r)).slice(0, 998)).filter((r) => /^<[^<>\s]+>$/.test(r)).slice(-20);
      const inReplyTo = typeof b.inReplyTo === 'string' && /^<[^<>\s]+>$/.test(oneLine(b.inReplyTo)) ? oneLine(b.inReplyTo).slice(0, 998) : undefined;
      const sent = await backend.send(x.c, {
        from: { name: x.row.displayName || d.me(req).displayName || '', address: x.row.email },
        to,
        cc,
        subject,
        text,
        inReplyTo,
        references: inReplyTo ? [...references.filter((r) => r !== inReplyTo), inReplyTo] : references,
        attachments,
      });
      return { ok: true, messageId: sent.messageId, savedCopy: sent.saved };
    } catch (e) {
      return fail(reply, e);
    }
  });
}
