import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from 'imapflow';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import nodemailer from 'nodemailer';
import { resolveMailHost, type HostResolver } from './hosts.js';
import { displayAddress, folderKind, folderRank, htmlToText, oneLine, toAddress, toAddresses } from './text.js';
import type { ListOptions, MailAttachmentInfo, MailBackend, MailConnection, MailFolder, MailMessage, MailSummary, NewMailCheck, OutgoingMail } from './types.js';

/** Größte Mail, die geöffnet wird (Bytes). Größeres bleibt auf dem Server des Anbieters. */
export const MAX_MESSAGE_BYTES = 40 * 1024 * 1024;
const TIMEOUT = 20_000;

export interface ImapOptions {
  allowPrivate?: boolean;
  resolver?: HostResolver;
  /** Nur für Tests (eigenes Zertifikat); im Betrieb bleibt die Prüfung des Zertifikats streng. */
  tls?: { rejectUnauthorized?: boolean; ca?: string | Buffer };
}

const addrs = (v: AddressObject | AddressObject[] | undefined): { name: string; address: string }[] => {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return list.flatMap((o) => o.value.map((a) => ({ name: a.name ?? '', address: a.address ?? '' }))).filter((a) => a.address);
};

/** Hat der Aufbau der Mail Anhänge? (Teile mit Disposition „attachment“ oder mit Dateinamen) */
export function structureHasAttachments(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  if (node.disposition === 'attachment') return true;
  if (node.disposition === 'inline' && node.dispositionParameters?.filename && !node.type.startsWith('text/') && !node.type.startsWith('image/')) return true;
  return (node.childNodes ?? []).some(structureHasAttachments);
}

function summary(m: FetchMessageObject): MailSummary {
  const env = m.envelope;
  return {
    uid: m.uid,
    from: toAddress(env?.from?.[0]),
    to: toAddresses(env?.to),
    subject: oneLine(env?.subject ?? ''),
    date: env?.date ? new Date(env.date).toISOString() : m.internalDate ? new Date(m.internalDate).toISOString() : '',
    seen: m.flags?.has('\\Seen') ?? false,
    hasAttachments: structureHasAttachments(m.bodyStructure),
  };
}

function parsedAttachments(p: ParsedMail): MailAttachmentInfo[] {
  return p.attachments
    .filter((a) => a.contentDisposition === 'attachment' || (!a.related && a.filename))
    .map((a, index) => ({ index, filename: a.filename || `Anhang ${index + 1}`, contentType: a.contentType || 'application/octet-stream', size: a.size ?? a.content.length }));
}

async function parse(m: FetchMessageObject): Promise<MailMessage> {
  const p = await simpleParser(m.source!);
  const html = typeof p.html === 'string' ? p.html : '';
  const text = (p.text ?? '').trim() || (html ? htmlToText(html) : '');
  const base = summary(m);
  const refs = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
  return {
    ...base,
    from: base.from ?? toAddress(addrs(p.from)[0]),
    to: base.to.length ? base.to : addrs(p.to),
    cc: addrs(p.cc),
    replyTo: addrs(p.replyTo),
    messageId: p.messageId ?? '',
    references: refs,
    text,
    fromHtml: !(p.text ?? '').trim() && !!html,
    attachments: parsedAttachments(p),
    hasAttachments: parsedAttachments(p).length > 0,
  };
}

/** Echte Anbindung per IMAP und SMTP. Jede Aktion öffnet eine kurze Verbindung (keine dauerhaften Verbindungen je Betreuer). */
export class ImapBackend implements MailBackend {
  constructor(private readonly opts: ImapOptions = {}) {}

  private async open(conn: MailConnection): Promise<ImapFlow> {
    const host = await resolveMailHost(conn.imapHost, this.opts);
    const client = new ImapFlow({
      host: host.ip,
      port: conn.imapPort,
      secure: conn.imapSecure,
      // Auch ohne TLS von Anfang an wird verschlüsselt, sonst gäbe es keine Verbindung: Das Passwort geht nie im Klartext über das Netz.
      doSTARTTLS: conn.imapSecure ? undefined : true,
      servername: host.servername,
      tls: this.opts.tls,
      auth: { user: conn.username, pass: conn.password },
      logger: false,
      connectionTimeout: TIMEOUT,
      greetingTimeout: TIMEOUT,
      socketTimeout: 60_000,
      disableAutoIdle: true,
    });
    client.on('error', () => undefined); // Fehler kommen über die Aufrufe zurück; ein loser „error“-Ereignis soll den Server nicht beenden
    await client.connect();
    return client;
  }

  private async with<T>(conn: MailConnection, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const client = await this.open(conn);
    try {
      return await fn(client);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  private async inFolder<T>(conn: MailConnection, folder: string, fn: (c: ImapFlow) => Promise<T>, readOnly = true): Promise<T> {
    return this.with(conn, async (c) => {
      const lock = await c.getMailboxLock(folder, { readOnly });
      try {
        return await fn(c);
      } finally {
        lock.release();
      }
    });
  }

  async test(conn: MailConnection): Promise<void> {
    await this.with(conn, async (c) => {
      await c.noop();
    });
    const smtp = await this.transport(conn);
    try {
      await smtp.verify();
    } finally {
      smtp.close();
    }
  }

  async folders(conn: MailConnection): Promise<MailFolder[]> {
    return this.with(conn, async (c) => {
      const list = await c.list();
      const out: MailFolder[] = [];
      for (const f of list) {
        if (f.flags.has('\\Noselect') || f.flags.has('\\NonExistent')) continue;
        const st = await c.status(f.path, { messages: true, unseen: true }).catch(() => false as const);
        out.push({ path: f.path, name: f.name, special: folderKind(f.path, f.specialUse), unseen: st ? (st.unseen ?? 0) : 0, total: st ? (st.messages ?? 0) : 0 });
      }
      return out.sort((a, b) => folderRank(a.special) - folderRank(b.special) || a.name.localeCompare(b.name, 'de'));
    });
  }

  async list(conn: MailConnection, folder: string, opts: ListOptions): Promise<{ total: number; items: MailSummary[] }> {
    return this.inFolder(conn, folder, async (c) => {
      const query = { uid: true, flags: true, envelope: true, bodyStructure: true, internalDate: true } as const;
      const items: MailSummary[] = [];
      if (opts.query) {
        const q = opts.query.slice(0, 100);
        const found = await c.search({ or: [{ subject: q }, { from: q }, { to: q }] }, { uid: true });
        const uids = (found || []).sort((a, b) => b - a);
        const slice = uids.slice((opts.page - 1) * opts.pageSize, opts.page * opts.pageSize);
        if (slice.length) for await (const m of c.fetch(slice.join(','), query, { uid: true })) items.push(summary(m));
        return { total: uids.length, items: items.sort((a, b) => b.uid - a.uid) };
      }
      const total = c.mailbox && typeof c.mailbox === 'object' ? c.mailbox.exists : 0;
      const hi = total - (opts.page - 1) * opts.pageSize;
      const lo = Math.max(1, hi - opts.pageSize + 1);
      if (hi >= 1) for await (const m of c.fetch(`${lo}:${hi}`, query)) items.push(summary(m));
      return { total, items: items.sort((a, b) => b.uid - a.uid) };
    });
  }

  async get(conn: MailConnection, folder: string, uid: number, markSeen: boolean): Promise<MailMessage | undefined> {
    return this.inFolder(
      conn,
      folder,
      async (c) => {
        const m = await c.fetchOne(String(uid), { uid: true, flags: true, envelope: true, bodyStructure: true, internalDate: true, size: true, source: true }, { uid: true });
        if (!m || !m.source) return undefined;
        if ((m.size ?? 0) > MAX_MESSAGE_BYTES) throw new Error('Diese Mail ist zu groß, um sie hier zu öffnen.');
        const msg = await parse(m);
        if (markSeen && !msg.seen) {
          await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }).catch(() => undefined);
          msg.seen = true;
        }
        return msg;
      },
      !markSeen,
    );
  }

  async attachment(conn: MailConnection, folder: string, uid: number, index: number) {
    return this.inFolder(conn, folder, async (c) => {
      const m = await c.fetchOne(String(uid), { uid: true, size: true, source: true }, { uid: true });
      if (!m || !m.source) return undefined;
      if ((m.size ?? 0) > MAX_MESSAGE_BYTES) throw new Error('Diese Mail ist zu groß, um ihre Anhänge zu öffnen.');
      const p = await simpleParser(m.source);
      const list = p.attachments.filter((a) => a.contentDisposition === 'attachment' || (!a.related && a.filename));
      const a = list[index];
      return a ? { filename: a.filename || `Anhang ${index + 1}`, contentType: a.contentType || 'application/octet-stream', content: a.content } : undefined;
    });
  }

  async setSeen(conn: MailConnection, folder: string, uid: number, seen: boolean): Promise<void> {
    await this.inFolder(
      conn,
      folder,
      async (c) => {
        if (seen) await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        else await c.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true });
      },
      false,
    );
  }

  async remove(conn: MailConnection, folder: string, uid: number): Promise<void> {
    await this.with(conn, async (c) => {
      const list = await c.list();
      const trash = list.find((f) => f.specialUse === '\\Trash');
      const lock = await c.getMailboxLock(folder);
      try {
        if (trash && trash.path !== folder) await c.messageMove(String(uid), trash.path, { uid: true });
        else await c.messageDelete(String(uid), { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  private async transport(conn: MailConnection) {
    const host = await resolveMailHost(conn.smtpHost, this.opts);
    return nodemailer.createTransport({
      host: host.ip,
      port: conn.smtpPort,
      secure: conn.smtpSecure,
      requireTLS: !conn.smtpSecure,
      auth: { user: conn.username, pass: conn.password },
      tls: { servername: host.servername, ...this.opts.tls },
      name: 'jf-hub',
      connectionTimeout: TIMEOUT,
      greetingTimeout: TIMEOUT,
      socketTimeout: 60_000,
      logger: false,
    });
  }

  async send(conn: MailConnection, mail: OutgoingMail): Promise<{ messageId: string; saved: boolean }> {
    const from = { name: oneLine(mail.from.name), address: mail.from.address };
    const composer = new MailComposer({
      from,
      to: mail.to,
      cc: mail.cc,
      subject: oneLine(mail.subject),
      text: mail.text,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
      attachments: mail.attachments.map((a) => ({ filename: oneLine(a.filename), contentType: a.contentType, content: a.content })),
    });
    const node = composer.compile();
    const raw = await node.build();
    const smtp = await this.transport(conn);
    let messageId = '';
    try {
      const info = await smtp.sendMail({ envelope: { from: from.address, to: [...mail.to, ...mail.cc].map((a) => a.address) }, raw });
      messageId = String(info.messageId ?? '');
    } finally {
      smtp.close();
    }
    // Viele Anbieter legen Mails, die per SMTP rausgehen, nicht selbst in „Gesendet“ ab (anders als ihre Weboberfläche).
    let saved = false;
    try {
      await this.with(conn, async (c) => {
        const sent = (await c.list()).find((f) => f.specialUse === '\\Sent');
        if (!sent) return;
        await c.append(sent.path, raw, ['\\Seen']);
        saved = true;
      });
    } catch {
      /* Die Mail ist raus; fehlt nur die Kopie, ist das kein Grund für eine Fehlermeldung. */
    }
    return { messageId, saved };
  }

  async checkNew(conn: MailConnection, state: { uidValidity: number | null; lastUid: number | null }): Promise<NewMailCheck> {
    return this.inFolder(conn, 'INBOX', async (c) => {
      const box = c.mailbox;
      if (!box || typeof box !== 'object') throw new Error('Posteingang nicht lesbar');
      const uidValidity = Number(box.uidValidity);
      const maxUid = Math.max(0, box.uidNext - 1);
      // Erste Prüfung oder neuer Posteingang (UIDVALIDITY geändert): Ausgangspunkt setzen, nichts melden.
      if (state.lastUid === null || state.uidValidity !== uidValidity) return { uidValidity, maxUid, fresh: [] };
      if (maxUid <= state.lastUid) return { uidValidity, maxUid, fresh: [] };
      const fresh: NewMailCheck['fresh'] = [];
      for await (const m of c.fetch(`${state.lastUid + 1}:*`, { uid: true, flags: true, envelope: true }, { uid: true })) {
        if (m.uid <= state.lastUid || m.flags?.has('\\Seen')) continue;
        fresh.push({ uid: m.uid, from: displayAddress(toAddress(m.envelope?.from?.[0])), subject: oneLine(m.envelope?.subject ?? '') });
      }
      return { uidValidity, maxUid, fresh: fresh.sort((a, b) => a.uid - b.uid) };
    });
  }
}
