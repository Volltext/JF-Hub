import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { zipSync, strToU8, type Zippable } from 'fflate';
import { existsSync, readFileSync, rmSync, mkdtempSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  acceptInvite,
  authenticate,
  checkPasswordRules,
  countUsers,
  createInvite,
  createSession,
  createUser,
  deleteUser,
  getUser,
  listSessions,
  listUsers,
  LoginThrottle,
  migrateLegacy,
  newSetupCode,
  publicUser,
  purgeExpiredSessions,
  revokeOtherSessions,
  revokeSession,
  revokeSessionById,
  setUserPassword,
  updateUser,
  UserError,
  validateSession,
  verifyPassword,
  type SessionUser,
} from './auth.js';
import { BLOB_ID_RE, BlobError, blobNodesOf, blobStats, checkUpload, findBlob, readBlobData, storeBlob, sweepBlobs, type BlobNode, type UploadRequest } from './blobs.js';
import { CONFIG_DEFAULTS, getSettings, nextRev, setConfig, type ConfigKey, type FolderRow, type ProtocolRow, type UserRow } from './db.js';
import { migrateBlobs } from './migrate.js';
import { pdfFileName, renderPdf, safeFileName, type PdfStyle } from './pdf.js';
import { parseClothingPdf, renderClothingPdf } from './clothingPdf.js';
import { applySync, canSee, purgeProtocol, sweepTrash, toServerDoc, VISIBLE_SQL, type SyncRequest } from './sync.js';
import { ensureVapid, PushError, replaceReminders, sendDue, subscribe, unsubscribe, webPushSender, type PushSender } from './push.js';
import { HolidayCache, type FetchLike } from './holidays.js';
import { sampleProtocol } from './sample.js';
import { autoKeep, backupPath, createBackup, deleteBackup, isBackupName, listBackups, pruneBackups, restoreFromFile, RestoreError, runAutoBackup, writeUpload } from './backup.js';
import { DEMO_ACCOUNTS, demoBlock, formatResetAt, isDemoAccount, msUntilReset, parseResetAt, resetDemo } from './demo.js';

export const VERSION = '2.1.0';
/**
 * Schnittstelle dieses Servers (steigt bei Änderungen, die ältere Apps nicht verstehen) und das kleinste Dokumentformat
 * (`X-JFH-Schema` der App), das er noch annimmt. Apps ohne Angabe (2.0.x) gelten als Schema 1.
 */
export const API_VERSION = 3;
export const MIN_SCHEMA = 2;
const COOKIE = 'jfh_session';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export interface AppOptions {
  db: DatabaseSync;
  /** Verzeichnis mit dem gebauten Web-Client (optional). */
  webDir?: string;
  /** Verzeichnis mit der Admin-GUI. */
  adminDir?: string;
  /** Konto aus der Umgebung (nur Erststart bzw. mit `resetPassword`). */
  adminUser?: string;
  adminPassword?: string;
  resetPassword?: boolean;
  /** Fastify-`trustProxy`: welchen vorgeschalteten Proxys `X-Forwarded-*` geglaubt wird. */
  trustProxy?: boolean | string | string[];
  /** Kontakt für den Push-Dienst (`mailto:` oder https-Adresse), Pflicht der VAPID-Spezifikation. */
  pushSubject?: string;
  /** Eigener Versand (Tests); sonst Web-Push mit den VAPID-Schlüsseln der Datenbank. */
  pushSender?: PushSender;
  /** false: Erinnerungen nicht automatisch verschicken (Tests). */
  pushTimer?: boolean;
  /** Ordner für Backups (`/data/backups`); ohne Angabe gibt es keine gespeicherten Backups und keine Wiederherstellung. */
  backupDir?: string;
  /** false: keine automatischen Backups (Tests). */
  backupTimer?: boolean;
  /**
   * Demo-Modus für eine öffentliche Probier-Instanz: Beispieldaten beim Start und täglich um `resetAt` (HH:MM, Standard 03:00),
   * feste Zugänge, keine Backups. `timer: false` schaltet das tägliche Zurücksetzen ab (Tests).
   */
  demo?: { resetAt?: string; timer?: boolean };
  fetchImpl?: FetchLike;
  logger?: boolean;
  /** Kleinstes Dokumentformat (`X-JFH-Schema`), das der Server annimmt; ältere Apps bekommen 426 (Standard: `MIN_SCHEMA`). */
  minSchema?: number;
  /** Tests: wird für jede registrierte Route aufgerufen (Grundlage des Sicherheitstests, der alle geschützten Routen durchgeht). */
  onRoute?: (route: { method: string; url: string }) => void;
}

/** Liest `TRUST_PROXY`: true/false, eine Liste (Komma) oder ein Name wie `loopback`. Standard: private Netze (Docker, Tunnel, Reverse-Proxy im Heimnetz). */
export function parseTrustProxy(v: string | undefined): boolean | string | string[] {
  if (v === undefined || v.trim() === '') return ['loopback', 'linklocal', 'uniquelocal'];
  const t = v.trim().toLowerCase();
  if (t === 'true' || t === '1') return true;
  if (t === 'false' || t === '0') return false;
  return t.includes(',') ? v.split(',').map((x) => x.trim()) : v.trim();
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance & { setupCode?: string }> {
  const { db } = opts;
  const minSchema = opts.minSchema ?? MIN_SCHEMA;
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: opts.trustProxy ?? parseTrustProxy(undefined), bodyLimit: 64 * 1024 * 1024 }) as FastifyInstance & {
    setupCode?: string;
  };

  if (opts.onRoute) {
    const report = opts.onRoute;
    app.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) report({ method: String(method), url: route.url });
    });
  }

  // Clients, die den Content-Type weglassen (z. B. native HTTP-Schichten), werden als JSON gelesen.
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    if (!body) return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('Ungültiges JSON'), { statusCode: 400 }), undefined);
    }
  });

  migrateLegacy(db);
  // Fotos und Dateien lagen bis 2.1.x im Inhalt der Protokolle. Hier ziehen sie in Blobs um (mit Backup davor, wiederholbar).
  if (!opts.demo) migrateBlobs(db, { backupDir: opts.backupDir, log: (message) => app.log.info(message) });
  const demoAt = opts.demo ? parseResetAt(opts.demo.resetAt) : undefined;
  if (opts.demo) {
    await resetDemo(db);
  } else if (opts.adminPassword) {
    const name = opts.adminUser || 'admin';
    const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(name) as UserRow | undefined;
    if (!existing && countUsers(db) === 0) {
      await createUser(db, { username: name, displayName: 'Admin', role: 'admin', password: opts.adminPassword });
    } else if (existing && opts.resetPassword) {
      await setUserPassword(db, existing.id, opts.adminPassword);
    }
  }
  if (countUsers(db) === 0) app.setupCode = newSetupCode();

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Strict-Transport-Security', 'max-age=31536000');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'",
    );
    // API-Antworten (Export, Backup, PDF) gehören nie in einen Zwischenspeicher, auch nicht in den eines CDN, das nach der Dateiendung cacht.
    if (!reply.hasHeader('cache-control') && (req.routeOptions.url ?? req.url).startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  // Der Router dekodiert den Pfad, `req.url` bleibt roh: Zugriffsregeln gehören deshalb ans Routenmuster (siehe unten). Zusätzlich
  // weisen wir Pfade ab, in denen Zeichen kodiert sind, die kein Client kodiert (Buchstaben, Ziffern, `-._~`).
  const ENCODED_UNRESERVED = /%(?:3[0-9]|4[1-9a-f]|5[0-9af]|6[1-9a-f]|7[0-9ae]|2[de])/i;
  app.addHook('onRequest', async (req, reply) => {
    if (ENCODED_UNRESERVED.test(req.url.split('?')[0]!)) return reply.code(400).send({ error: 'Ungültiger Pfad' });
  });

  const tokenOf = (req: FastifyRequest): { token?: string; viaCookie: boolean } => {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) return { token: h.slice(7), viaCookie: false };
    return { token: req.cookies[COOKIE], viaCookie: true };
  };

  /** Alle /api-Routen außer den öffentlichen verlangen eine gültige Sitzung; /api/admin/ zusätzlich die Admin-Rolle. */
  const PUBLIC = new Set(['/api/health', '/api/status', '/api/login', '/api/setup', '/api/invite/accept']);
  if (opts.demo) {
    // Vor dem Lesen des Bodys: gesperrt ist gesperrt, auch für große Uploads.
    app.addHook('onRequest', async (req, reply) => {
      const blocked = demoBlock(db, req.method, req.routeOptions.url, req.params);
      if (blocked) return reply.code(403).send({ error: blocked });
    });
  }
  // Vor dem Lesen des Bodys. Maßgeblich ist das Muster der Route, die der Router gefunden hat – nicht die rohe URL.
  // Ohne Muster (404, statische Dateien) gibt es nichts zu schützen.
  app.addHook('onRequest', async (req, reply) => {
    const route = req.routeOptions.url;
    if (!route?.startsWith('/api/') || PUBLIC.has(route)) return;
    const { token, viaCookie } = tokenOf(req);
    const user = validateSession(db, token);
    if (!user) return reply.code(401).send({ error: 'Nicht angemeldet' });
    // Cookie-Sitzungen brauchen bei Schreibzugriffen einen eigenen Header (CSRF-Schutz).
    if (viaCookie && !['GET', 'HEAD'].includes(req.method) && req.headers['x-jfh'] !== '1') {
      return reply.code(403).send({ error: 'Ungültige Anfrage' });
    }
    if (route.startsWith('/api/admin/') && user.role !== 'admin') return reply.code(403).send({ error: 'Nur für Admins' });
    req.user = user;
  });

  const me = (req: FastifyRequest): SessionUser => req.user!;

  const setCookie = (req: FastifyRequest, reply: FastifyReply, token: string, expiresAt: number) => {
    reply.setCookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.protocol === 'https',
      path: '/',
      expires: new Date(expiresAt),
    });
  };

  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof UserError || e instanceof PushError) return reply.code(e.status).send({ error: e.message });
    return reply.code(400).send({ error: (e as Error).message });
  };

  const throttle = new LoginThrottle();
  const startSession = (req: FastifyRequest, reply: FastifyReply, user: UserRow, device: unknown) => {
    const s = createSession(db, user.id, typeof device === 'string' ? device : '');
    setCookie(req, reply, s.token, s.expiresAt);
    return { ...s, user: publicUser(user) };
  };

  // ---------- öffentlich ----------
  app.get('/api/health', async () => ({ ok: true, version: VERSION }));
  /** Im Demo-Modus mit den Zugängen, damit die Anmeldeseiten sie anbieten können (sie sind ohnehin öffentlich). */
  const demoInfo = demoAt && {
    resetAt: formatResetAt(demoAt),
    accounts: DEMO_ACCOUNTS.map(({ username, password, displayName, role, hint }) => ({ username, password, displayName, role, hint })),
  };
  app.get('/api/status', async () => ({ setupRequired: countUsers(db) === 0, version: VERSION, api: API_VERSION, minSchema, features: ['blobs'], orgName: getSettings(db).orgName, ...(demoInfo ? { demo: demoInfo } : {}) }));

  app.post<{ Body: { code?: string; username?: string; displayName?: string; password?: string; device?: string } }>(
    '/api/setup',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      if (countUsers(db) > 0 || !app.setupCode) return reply.code(409).send({ error: 'Bereits eingerichtet' });
      const { code, username, displayName, password, device } = req.body ?? {};
      if (typeof code !== 'string' || code.trim().toUpperCase() !== app.setupCode) {
        return reply.code(403).send({ error: 'Setup-Code falsch (siehe Container-Log)' });
      }
      try {
        checkPasswordRules(password);
        const user = await createUser(db, { username, displayName, role: 'admin', password });
        app.setupCode = undefined;
        return startSession(req, reply, user, device || 'Admin-Browser');
      } catch (e) {
        return fail(reply, e);
      }
    },
  );

  app.post<{ Body: { username?: string; password?: string; device?: string } }>(
    '/api/login',
    // Demo: viele Besucher teilen sich eine Adresse (z. B. alle im WLAN eines Lehrgangs).
    { config: { rateLimit: { max: opts.demo ? 60 : 8, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const { username, password, device } = req.body ?? {};
      if (typeof username !== 'string' || typeof password !== 'string') return reply.code(400).send({ error: 'Benutzername und Passwort angeben' });
      // Die Demo-Zugänge sind öffentlich: Fehlversuche dürfen sie nicht für alle sperren.
      const guarded = !(opts.demo && isDemoAccount(username));
      if (guarded && throttle.blocked(username)) return reply.code(429).send({ error: 'Zu viele Versuche für dieses Konto. Bitte später erneut probieren.' });
      const user = await authenticate(db, username, password);
      if (!user) {
        if (guarded) throttle.fail(username);
        return reply.code(401).send({ error: 'Benutzername oder Passwort falsch' });
      }
      throttle.reset(username);
      return startSession(req, reply, user, device);
    },
  );

  /** Einladung annehmen: Benutzername + Einladungscode + eigenes Passwort. */
  app.post<{ Body: { username?: string; code?: string; password?: string; device?: string } }>(
    '/api/invite/accept',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const { username, code, password, device } = req.body ?? {};
      if (typeof username !== 'string' || typeof code !== 'string' || typeof password !== 'string') return reply.code(400).send({ error: 'Angaben unvollständig' });
      if (throttle.blocked(username)) return reply.code(429).send({ error: 'Zu viele Versuche. Bitte später erneut probieren.' });
      try {
        const user = await acceptInvite(db, username, code, password);
        throttle.reset(username);
        return startSession(req, reply, user, device);
      } catch (e) {
        if (e instanceof UserError && e.status === 403) throttle.fail(username);
        return fail(reply, e);
      }
    },
  );

  // ---------- angemeldet ----------
  app.post('/api/logout', async (req, reply) => {
    const { token } = tokenOf(req);
    if (token) revokeSession(db, token);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => ({ ok: true, user: publicUser(getUser(db, me(req).id)!), orgName: getSettings(db).orgName }));

  app.post<{ Body: { current?: string; next?: string } }>('/api/account/password', async (req, reply) => {
    const { current, next } = req.body ?? {};
    const user = getUser(db, me(req).id)!;
    if (typeof current !== 'string' || !user.passwordHash || !(await verifyPassword(current, user.passwordHash))) {
      return reply.code(403).send({ error: 'Aktuelles Passwort falsch' });
    }
    try {
      await setUserPassword(db, user.id, next as string, tokenOf(req).token); // andere Geräte müssen sich neu anmelden
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get('/api/account/sessions', async (req) => listSessions(db, tokenOf(req).token, me(req).id));
  app.delete<{ Params: { id: string } }>('/api/account/sessions/:id', async (req) => {
    revokeSessionById(db, req.params.id, me(req).id);
    return { ok: true };
  });
  app.post('/api/account/sessions/revoke-others', async (req) => {
    revokeOtherSessions(db, me(req).id, tokenOf(req).token);
    return { ok: true };
  });

  app.post<{ Body: SyncRequest }>('/api/sync', async (req, reply) => {
    // Eine App, die das aktuelle Dokumentformat nicht kennt, würde Inhalte, die sie nicht versteht, beim Speichern verwerfen.
    const schema = Number(req.headers['x-jfh-schema'] ?? 1);
    if (!(schema >= minSchema)) {
      return reply.code(426).send({ error: 'Diese App-Version ist zu alt für den Server. Bitte die App aktualisieren.', code: 'client_too_old', minSchema });
    }
    try {
      return { ...applySync(db, req.body, me(req)), api: API_VERSION, minSchema };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  const style = (): PdfStyle => {
    const s = getSettings(db);
    return { orgName: s.orgName, footer: s.footer, accent: s.accent, logo: s.logo };
  };

  /** Foto aus einem Blob als Data-URL für das PDF. Der Aufrufer hat das Protokoll schon geprüft, auf das das Foto verweist. */
  const imageOf = (blobId: string): string | null => {
    const row = db.prepare("SELECT data FROM blobs WHERE id = ? AND kind = 'photo'").get(blobId) as { data: Uint8Array } | undefined;
    return row ? `data:image/jpeg;base64,${Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength).toString('base64')}` : null;
  };

  // ---------- Anhänge (Fotos, Dateien) ----------
  // Die App legt den Anhang lokal ab und lädt ihn hoch, bevor sie das Protokoll sendet, das auf ihn verweist. Die Kennung vergibt sie selbst.
  app.put<{ Params: { id: string }; Body: unknown }>(
    '/api/blobs/:id',
    { bodyLimit: 16 * 1024 * 1024, config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply.code(400).send({ error: 'Ungültige Anfrage' });
      const id = req.params.id;
      try {
        const upload = checkUpload({ id, ...(body as Omit<UploadRequest, 'id'>) }, { demo: !!opts.demo });
        const stored = storeBlob(db, { id, ...upload, uploaderId: me(req).id });
        return { ok: true, id, size: upload.data.length, sha256: stored.sha256, created: stored.created };
      } catch (e) {
        if (e instanceof BlobError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  /** Auslieferung: Fotos als Bild, alles andere nur als Download (nie inline, damit hochgeladene Seiten nicht laufen). */
  app.get<{ Params: { id: string } }>('/api/blobs/:id', async (req, reply) => {
    const meta = BLOB_ID_RE.test(req.params.id) ? findBlob(db, req.params.id, me(req).id) : undefined;
    if (!meta) return reply.code(404).send({ error: 'Nicht gefunden' });
    const photo = meta.kind === 'photo';
    reply.header('Content-Type', photo ? 'image/jpeg' : 'application/octet-stream');
    reply.header('Content-Disposition', photo ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName(meta.name, 'Datei', 120))}`);
    if (req.method === 'HEAD') return reply.header('Content-Length', meta.size).send();
    return reply.send(readBlobData(db, meta.id));
  });

  app.get<{ Params: { id: string } }>('/api/protocols/:id/pdf', async (req, reply) => {
    const row = db.prepare('SELECT * FROM protocols WHERE id = ?').get(req.params.id) as ProtocolRow | undefined;
    if (!row || row.deletedAt !== null || !canSee(row, me(req))) return reply.code(404).send({ error: 'Nicht gefunden' });
    const doc = toServerDoc(row);
    let pdf: Buffer;
    try {
      pdf = await renderPdf(doc, style(), { image: imageOf });
    } catch (e) {
      // Der Inhalt kommt von Clients und wird nicht geprüft: ein unbrauchbares Protokoll darf nur sein eigenes PDF verhindern.
      app.log.warn({ err: e, protocol: row.id }, 'PDF konnte nicht erzeugt werden');
      return reply.code(422).send({ error: 'Dieses Protokoll kann nicht als PDF ausgegeben werden.' });
    }
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(pdfFileName(doc))}.pdf`)
      .send(pdf);
  });

  /** Papierkorb: die eigenen gelöschten Protokolle (Admin: zusätzlich veröffentlichte anderer), neueste zuerst. */
  app.get('/api/protocols/trash', async (req) => {
    const user = me(req);
    const items = db
      .prepare(
        `SELECT p.id, p.title, p.datum, p.ort, p.deletedAt, p.shared, p.ownerId, COALESCE(u.displayName, u.username, '') AS owner
         FROM protocols p LEFT JOIN users u ON u.id = p.ownerId
         WHERE p.deletedAt IS NOT NULL AND p.purgedAt IS NULL AND (p.ownerId = ? OR (? = 1 AND p.shared = 1))
         ORDER BY p.deletedAt DESC`,
      )
      .all(user.id, user.role === 'admin' ? 1 : 0);
    return { items, trashDays: Number(getSettings(db).trashDays) || 30 };
  });

  /** Holt ein Protokoll aus dem Papierkorb zurück (Besitzer oder Admin). Die Geräte bekommen es beim nächsten Abgleich. */
  app.post<{ Params: { id: string } }>('/api/protocols/:id/restore', async (req, reply) => {
    const user = me(req);
    const who = [user.id, user.role === 'admin' ? 1 : 0] as const;
    const row = db
      .prepare('SELECT id FROM protocols WHERE id = ? AND deletedAt IS NOT NULL AND purgedAt IS NULL AND (ownerId = ? OR (? = 1 AND shared = 1))')
      .get(req.params.id, ...who);
    if (!row) return reply.code(404).send({ error: 'Nicht im Papierkorb' });
    db.prepare('UPDATE protocols SET deletedAt = NULL, rev = ?, updatedAt = ? WHERE id = ?').run(nextRev(db), Date.now(), req.params.id);
    return { ok: true };
  });

  /** Kleidertabelle als PDF: die App schickt die Zeilen, der Server setzt sie im Stil der Protokoll-PDFs. */
  app.post('/api/clothing/pdf', async (req, reply) => {
    let data;
    try {
      data = parseClothingPdf(req.body);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const pdf = await renderClothingPdf(data, style());
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(`Kleidertabelle ${data.date}`)}.pdf`)
      .send(pdf);
  });

  /** Alle für den Nutzer sichtbaren Protokolle als ZIP (PDF + JSON), Ordnerstruktur wie in der App. */
  app.get('/api/export.zip', async (req, reply) => {
    const rows = db.prepare(`SELECT * FROM protocols WHERE deletedAt IS NULL AND ${VISIBLE_SQL} ORDER BY datum`).all(me(req).id) as unknown as ProtocolRow[];
    const files: Zippable = {};
    /** Fotos und Dateien der exportierten Protokolle, unter ihrer Kennung (das JSON verweist darauf). Bilder sind schon komprimiert. */
    const addAttachment = (node: BlobNode) => {
      const blob = db.prepare('SELECT kind, data FROM blobs WHERE id = ?').get(node.blobId) as { kind: string; data: Uint8Array } | undefined;
      if (!blob) return;
      const path = blob.kind === 'photo' ? `attachments/${node.blobId}.jpg` : `attachments/${node.blobId}-${safeFileName(node.name, 'Datei', 120)}`;
      files[path] ??= [new Uint8Array(blob.data), { level: 0 }];
    };
    const st = style();
    const used = new Set<string>();
    const folders = new Map((db.prepare('SELECT * FROM folders WHERE deletedAt IS NULL').all() as unknown as FolderRow[]).map((f) => [f.id, f]));
    const dirOf = (id: string): string => {
      const parts: string[] = [];
      for (let f = folders.get(id), n = 0; f && n < 50; f = folders.get(f.parentId), n++) parts.unshift(safeFileName(f.name, 'Ordner', 120));
      return parts.length ? `${parts.join('/')}/` : '';
    };
    const problems: string[] = [];
    for (const r of rows) {
      const doc = toServerDoc(r);
      const dir = dirOf(doc.folderId);
      let base = pdfFileName(doc);
      while (used.has(dir + base)) base += '_';
      used.add(dir + base);
      files[`json/${dir}${base}.json`] = strToU8(JSON.stringify(doc, null, 2));
      for (const node of blobNodesOf(doc.content)) addAttachment(node);
      try {
        files[`${dir}${base}.pdf`] = new Uint8Array(await renderPdf(doc, st, { image: imageOf }));
      } catch (e) {
        // Ein unbrauchbarer Inhalt darf den Export der übrigen nicht verhindern; der Rohinhalt liegt unter json/ bei.
        app.log.warn({ err: e, protocol: r.id }, 'PDF für den Export nicht erzeugt');
        problems.push(`${doc.datum} ${doc.title || 'Ohne Titel'} (${r.id}): PDF konnte nicht erzeugt werden, der Rohinhalt liegt unter json/ bei.`);
      }
    }
    if (problems.length) files['export-fehler.txt'] = strToU8(`${problems.join('\n')}\n`);
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', 'attachment; filename="protokolle.zip"')
      .send(Buffer.from(zipSync(files, { level: 3 })));
  });

  // ---------- Ferien (Weitergabe von openholidaysapi.org) ----------
  const holidays = new HolidayCache(opts.fetchImpl);
  app.get<{ Querystring: { state?: string } }>('/api/holidays', async (req, reply) => {
    try {
      return await holidays.get(String(req.query.state ?? ''));
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // ---------- Web-Push ----------
  const vapid = ensureVapid(db);
  let sender: PushSender | undefined;
  const getSender = (): PushSender => (sender ??= opts.pushSender ?? webPushSender(db, opts.pushSubject || 'mailto:admin@example.com'));
  app.get('/api/push/key', async () => ({ publicKey: vapid.publicKey }));

  app.post<{ Body: { subscription?: unknown; device?: string } }>('/api/push/subscribe', async (req, reply) => {
    try {
      subscribe(db, me(req).id, me(req).sessionHash, req.body?.subscription as never, String(req.body?.device ?? ''));
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Body: { endpoint?: string } }>('/api/push/unsubscribe', async (req) => {
    unsubscribe(db, me(req).id, req.body?.endpoint);
    return { ok: true };
  });

  /** Schickt sofort eine Testnachricht an dieses Gerät (zum Prüfen von HTTPS, Berechtigung und Push-Dienst). */
  app.post<{ Body: { endpoint?: string } }>('/api/push/test', async (req, reply) => {
    const row = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ? AND userId = ?').get(String(req.body?.endpoint ?? ''), me(req).id) as
      | { endpoint: string; p256dh: string; auth: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'Gerät nicht für Push angemeldet' });
    try {
      await getSender()({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, { title: 'JF Hub', body: 'Testbenachrichtigung: So melden sich Erinnerungen.', url: '/', tag: 'test' });
      return { ok: true };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(row.endpoint);
      return reply.code(502).send({ error: `Der Push-Dienst hat die Nachricht abgelehnt${status ? ` (${status})` : ''}. Bitte Benachrichtigungen aus- und wieder einschalten.` });
    }
  });

  app.put<{ Body: { endpoint?: string; kind?: string; reminders?: unknown } }>('/api/push/reminders', async (req, reply) => {
    try {
      const n = replaceReminders(db, me(req).id, req.body?.endpoint, req.body?.kind, req.body?.reminders);
      return { ok: true, count: n };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ---------- Administration ----------
  app.get('/api/admin/info', async () => {
    const count = (where: string) => (db.prepare(`SELECT COUNT(*) AS n FROM protocols WHERE ${where}`).get() as { n: number }).n;
    const blobs = blobStats(db);
    return {
      version: VERSION,
      node: process.version,
      uptime: Math.round(process.uptime()),
      protocols: count('deletedAt IS NULL'),
      trashed: count('deletedAt IS NOT NULL AND purgedAt IS NULL'),
      users: countUsers(db),
      blobs: blobs.count,
      blobBytes: blobs.bytes,
    };
  });

  app.get('/api/admin/settings', async () => getSettings(db));

  app.put<{ Body: Partial<Record<ConfigKey, string>> }>('/api/admin/settings', async (req, reply) => {
    const b = req.body ?? {};
    const out: Partial<Record<ConfigKey, string>> = {};
    for (const k of Object.keys(CONFIG_DEFAULTS) as ConfigKey[]) {
      if (b[k] === undefined) continue;
      const v = b[k];
      if (typeof v !== 'string') return reply.code(400).send({ error: `${k}: ungültig` });
      if (k === 'accent' && !/^#[0-9a-fA-F]{6}$/.test(v)) return reply.code(400).send({ error: 'Akzentfarbe: #RRGGBB' });
      if (k === 'logo' && v !== '' && (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v) || v.length > 700_000)) {
        return reply.code(400).send({ error: 'Logo: PNG/JPEG, max. ca. 500 KB' });
      }
      if (k === 'backupKeep' && !/^\d{1,3}$/.test(v)) return reply.code(400).send({ error: 'Backups: 0–365 aufbewahren' });
      if ((k === 'tokenDays' || k === 'trashDays') && !(Number(v) >= 1 && Number(v) <= 3650)) {
        return reply.code(400).send({ error: `${k}: 1–3650 Tage` });
      }
      if ((k === 'orgName' || k === 'footer') && v.length > 200) return reply.code(400).send({ error: `${k}: zu lang` });
      out[k] = v;
    }
    for (const [k, v] of Object.entries(out)) setConfig(db, k, v);
    return getSettings(db);
  });

  const userView = (u: UserRow) => ({ ...publicUser(u), disabled: u.disabled === 1, invited: !u.passwordHash, inviteExpiresAt: u.inviteExpiresAt, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt });

  app.get('/api/admin/users', async () => listUsers(db).map(userView));

  app.post<{ Body: { username?: string; displayName?: string; role?: string } }>('/api/admin/users', async (req, reply) => {
    try {
      const role = req.body?.role === 'admin' ? 'admin' : 'betreuer';
      const user = await createUser(db, { username: req.body?.username, displayName: req.body?.displayName, role });
      return { user: userView(user), invite: createInvite(db, user.id) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.patch<{ Params: { id: string }; Body: { displayName?: string; role?: string; disabled?: boolean } }>('/api/admin/users/:id', async (req, reply) => {
    try {
      const { displayName, role, disabled } = req.body ?? {};
      return userView(updateUser(db, req.params.id, { displayName, role, disabled }));
    } catch (e) {
      return fail(reply, e);
    }
  });

  /** Neuer Einladungscode, z. B. wenn jemand sein Passwort vergessen hat. Das alte Passwort gilt bis zur Annahme weiter. */
  app.post<{ Params: { id: string } }>('/api/admin/users/:id/invite', async (req, reply) => {
    try {
      return createInvite(db, req.params.id);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (req, reply) => {
    try {
      deleteUser(db, req.params.id, me(req).id);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get('/api/admin/sessions', async (req) => listSessions(db, tokenOf(req).token));
  app.delete<{ Params: { id: string } }>('/api/admin/sessions/:id', async (req) => {
    revokeSessionById(db, req.params.id);
    return { ok: true };
  });

  /** Verwaltung der Protokolle: nur, was der Admin auch sonst sehen darf (veröffentlicht oder eigen). */
  app.get('/api/admin/protocols', async (req) => {
    return db
      .prepare(
        `SELECT p.id, p.title, p.datum, p.ort, p.rev, p.updatedAt, p.deletedAt, p.shared, COALESCE(u.displayName, u.username, '') AS owner,
           length(p.content) + COALESCE((SELECT SUM(b.size) FROM blob_refs r JOIN blobs b ON b.id = r.blobId WHERE r.protocolId = p.id), 0) AS size
         FROM protocols p LEFT JOIN users u ON u.id = p.ownerId
         WHERE (p.shared = 1 OR p.ownerId = ?) AND p.purgedAt IS NULL
         ORDER BY (p.deletedAt IS NOT NULL), p.datum DESC, p.updatedAt DESC`,
      )
      .all(me(req).id);
  });

  app.post<{ Params: { id: string } }>('/api/admin/protocols/:id/restore', async (req, reply) => {
    const r = db
      .prepare(`UPDATE protocols SET deletedAt = NULL, rev = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NOT NULL AND purgedAt IS NULL AND ${VISIBLE_SQL}`)
      .run(nextRev(db), Date.now(), req.params.id, me(req).id);
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'Nicht im Papierkorb' });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/protocols/:id', async (req, reply) => {
    const row = db.prepare(`SELECT id FROM protocols WHERE id = ? AND deletedAt IS NOT NULL AND purgedAt IS NULL AND ${VISIBLE_SQL}`).get(req.params.id, me(req).id);
    return row && purgeProtocol(db, req.params.id) ? { ok: true } : reply.code(404).send({ error: 'Nur Papierkorb-Einträge können endgültig gelöscht werden' });
  });

  app.get('/api/admin/backup', async (_req, reply) => {
    const dir = mkdtempSync(join(tmpdir(), 'jfh-'));
    const file = join(dir, 'backup.sqlite');
    try {
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const data = readFileSync(file);
      const stamp = new Date().toISOString().slice(0, 10);
      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="jf-hub-backup-${stamp}.sqlite"`)
        .send(data);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---------- gespeicherte Backups und Wiederherstellung ----------
  const backupDir = opts.backupDir;
  app.addContentTypeParser('application/x-sqlite3', { parseAs: 'buffer', bodyLimit: 512 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  const needDir = (reply: FastifyReply) => (backupDir ? backupDir : void reply.code(404).send({ error: 'Gespeicherte Backups sind auf diesem Server nicht eingerichtet' }));

  app.get('/api/admin/backups', async () => ({
    enabled: !!backupDir,
    keep: autoKeep(db),
    items: backupDir ? listBackups(backupDir) : [],
  }));

  app.post('/api/admin/backups', async (_req, reply) => {
    const dir = needDir(reply);
    if (!dir) return;
    const made = createBackup(db, dir, 'manuell');
    pruneBackups(dir, autoKeep(db));
    return made;
  });

  app.get<{ Params: { name: string } }>('/api/admin/backups/:name', async (req, reply) => {
    const dir = needDir(reply);
    if (!dir) return;
    const file = backupPath(dir, req.params.name);
    if (!file) return reply.code(404).send({ error: 'Backup nicht gefunden' });
    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${req.params.name}"`)
      .send(createReadStream(file));
  });

  app.delete<{ Params: { name: string } }>('/api/admin/backups/:name', async (req, reply) => {
    const dir = needDir(reply);
    if (!dir) return;
    return deleteBackup(dir, req.params.name) ? { ok: true } : reply.code(404).send({ error: 'Backup nicht gefunden' });
  });

  /** Vor jeder Wiederherstellung sichert der Server den aktuellen Stand (Art „vorher“), damit sie sich rückgängig machen lässt. */
  const restore = (reply: FastifyReply, dir: string, file: string) => {
    const before = createBackup(db, dir, 'vorher');
    try {
      restoreFromFile(db, file);
      pruneBackups(dir, autoKeep(db));
      return { ok: true, before: before.name };
    } catch (e) {
      deleteBackup(dir, before.name);
      if (e instanceof RestoreError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  };

  app.post<{ Params: { name: string } }>('/api/admin/backups/:name/restore', async (req, reply) => {
    const dir = needDir(reply);
    if (!dir) return;
    const file = backupPath(dir, req.params.name);
    if (!file || !isBackupName(req.params.name)) return reply.code(404).send({ error: 'Backup nicht gefunden' });
    return restore(reply, dir, file);
  });

  /** Eine hochgeladene Datenbank-Datei (Content-Type application/x-sqlite3) einspielen. */
  app.post<{ Body: Buffer }>('/api/admin/restore', async (req, reply) => {
    const dir = needDir(reply);
    if (!dir) return;
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) return reply.code(400).send({ error: 'Keine Datenbank-Datei übermittelt' });
    const up = writeUpload(req.body);
    try {
      return restore(reply, dir, up.file);
    } finally {
      up.cleanup();
    }
  });

  /** Beispiel-PDF für die Layout-Vorschau in der Admin-GUI. */
  app.get('/api/admin/preview.pdf', async (_req, reply) => {
    return reply.header('Content-Type', 'application/pdf').send(await renderPdf(sampleProtocol(), style()));
  });

  // ---------- statische Dateien ----------
  if (opts.adminDir && existsSync(opts.adminDir)) {
    await app.register(fastifyStatic, { root: opts.adminDir, prefix: '/admin/' });
  }
  if (opts.webDir && existsSync(opts.webDir)) {
    await app.register(fastifyStatic, {
      root: opts.webDir,
      prefix: '/',
      decorateReply: false,
      // Einstiegsdateien immer prüfen (sonst bleibt ein alter Service Worker bzw. eine alte App hängen); Assets tragen einen Hash im Namen.
      setHeaders: (res, path) => {
        const immutable = /[\\/]assets[\\/]/.test(path);
        res.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Nicht gefunden' });
    return reply.code(404).send('Nicht gefunden');
  });

  const timer = setInterval(() => {
    purgeExpiredSessions(db);
    sweepTrash(db);
    sweepBlobs(db);
  }, 6 * 3_600_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));

  if (backupDir && opts.backupTimer !== false && !opts.demo) {
    const tick = () => {
      try {
        runAutoBackup(db, backupDir);
      } catch (e) {
        app.log.warn({ err: e }, 'Automatisches Backup fehlgeschlagen');
      }
    };
    const first = setTimeout(tick, 60_000);
    const backupTimer = setInterval(tick, 3_600_000);
    first.unref();
    backupTimer.unref();
    app.addHook('onClose', async () => {
      clearTimeout(first);
      clearInterval(backupTimer);
    });
  }

  if (demoAt && opts.demo?.timer !== false) {
    let closed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    const plan = () => {
      if (closed) return;
      next = setTimeout(() => {
        resetDemo(db)
          .then(() => app.log.info('Demo zurückgesetzt'))
          .catch((e) => app.log.warn({ err: e }, 'Demo konnte nicht zurückgesetzt werden'))
          .finally(plan);
      }, msUntilReset(new Date(), demoAt));
      next.unref();
    };
    plan();
    app.addHook('onClose', async () => {
      closed = true;
      clearTimeout(next);
    });
  }

  if (opts.pushTimer !== false) {
    const pushTimer = setInterval(() => {
      sendDue(db, getSender()).catch((e) => app.log.warn({ err: e }, 'Push-Versand fehlgeschlagen'));
    }, 30_000);
    pushTimer.unref();
    app.addHook('onClose', async () => clearInterval(pushTimer));
  }

  return app;
}
