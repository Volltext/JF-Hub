import type { ListOptions, MailAttachmentInfo, MailBackend, MailConnection, MailFolder, MailMessage, MailSummary, NewMailCheck, OutgoingMail } from './types.js';

/** Attrappe eines Postfachs für Tests: Mails im Speicher, Zugangsdaten werden verglichen. */
export class FakeMailBackend implements MailBackend {
  messages: (MailMessage & { folder: string; content: Record<number, Buffer> })[] = [];
  sent: { conn: MailConnection; mail: OutgoingMail }[] = [];
  password = 'richtiges-passwort';
  /** Wirft bei jedem Zugriff (Server nicht erreichbar). */
  down: (Error & { code?: string }) | undefined;
  uidValidity = 1;
  private nextUid = 1;
  calls: string[] = [];

  add(over: Partial<MailMessage> & { folder?: string; content?: Record<number, Buffer> } = {}): number {
    const uid = this.nextUid++;
    const { folder = 'INBOX', content = {}, ...rest } = over;
    this.messages.push({
      uid,
      folder,
      content,
      from: { name: 'Anna Beispiel', address: 'anna@example.org' },
      to: [{ name: '', address: 'ich@gmx.de' }],
      cc: [],
      replyTo: [],
      subject: `Betreff ${uid}`,
      date: new Date(2026, 10, 1, 12, uid).toISOString(),
      seen: false,
      hasAttachments: false,
      messageId: `<m${uid}@example.org>`,
      references: [],
      text: `Text ${uid}`,
      fromHtml: false,
      attachments: [],
      ...rest,
    });
    return uid;
  }

  private check(conn: MailConnection) {
    this.calls.push('check');
    if (this.down) throw this.down;
    if (conn.password !== this.password) throw Object.assign(new Error('Invalid credentials'), { authenticationFailed: true });
  }

  async test(conn: MailConnection) {
    this.check(conn);
  }

  async folders(conn: MailConnection): Promise<MailFolder[]> {
    this.check(conn);
    const inbox = this.messages.filter((m) => m.folder === 'INBOX');
    return [
      { path: 'INBOX', name: 'Posteingang', special: 'inbox', unseen: inbox.filter((m) => !m.seen).length, total: inbox.length },
      { path: 'Gesendet', name: 'Gesendet', special: 'sent', unseen: 0, total: 0 },
    ];
  }

  async list(conn: MailConnection, folder: string, opts: ListOptions): Promise<{ total: number; items: MailSummary[] }> {
    this.check(conn);
    let all = this.messages.filter((m) => m.folder === folder);
    if (opts.query) all = all.filter((m) => m.subject.toLowerCase().includes(opts.query!.toLowerCase()));
    all = [...all].sort((a, b) => b.uid - a.uid);
    const items = all.slice((opts.page - 1) * opts.pageSize, opts.page * opts.pageSize).map(({ cc: _c, replyTo: _r, messageId: _m, references: _f, text: _t, fromHtml: _h, attachments: _a, content: _x, folder: _o, ...s }) => s);
    return { total: all.length, items };
  }

  async get(conn: MailConnection, folder: string, uid: number, markSeen: boolean): Promise<MailMessage | undefined> {
    this.check(conn);
    const m = this.messages.find((x) => x.folder === folder && x.uid === uid);
    if (!m) return undefined;
    if (markSeen) m.seen = true;
    const { folder: _o, content: _c, ...msg } = m;
    return msg;
  }

  async attachment(conn: MailConnection, folder: string, uid: number, index: number) {
    this.check(conn);
    const m = this.messages.find((x) => x.folder === folder && x.uid === uid);
    const info: MailAttachmentInfo | undefined = m?.attachments[index];
    const content = m?.content[index];
    return info && content ? { filename: info.filename, contentType: info.contentType, content } : undefined;
  }

  async setSeen(conn: MailConnection, folder: string, uid: number, seen: boolean) {
    this.check(conn);
    const m = this.messages.find((x) => x.folder === folder && x.uid === uid);
    if (m) m.seen = seen;
  }

  async remove(conn: MailConnection, folder: string, uid: number) {
    this.check(conn);
    this.messages = this.messages.filter((m) => !(m.folder === folder && m.uid === uid));
  }

  async send(conn: MailConnection, mail: OutgoingMail) {
    this.check(conn);
    this.sent.push({ conn, mail });
    return { messageId: `<sent${this.sent.length}@jf-hub>`, saved: true };
  }

  async checkNew(conn: MailConnection, state: { uidValidity: number | null; lastUid: number | null }): Promise<NewMailCheck> {
    this.check(conn);
    const inbox = this.messages.filter((m) => m.folder === 'INBOX');
    const maxUid = inbox.reduce((n, m) => Math.max(n, m.uid), 0);
    if (state.lastUid === null || state.uidValidity !== this.uidValidity) return { uidValidity: this.uidValidity, maxUid, fresh: [] };
    const fresh = inbox
      .filter((m) => m.uid > state.lastUid! && !m.seen)
      .map((m) => ({ uid: m.uid, from: m.from?.name || m.from?.address || '', subject: m.subject }));
    return { uidValidity: this.uidValidity, maxUid, fresh };
  }
}
