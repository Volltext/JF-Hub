import { loadConn, request } from '@/features/protokolle/http';

/** Antworten des Servers (`server/src/mail/`). Mails gibt es nur mit Verbindung: Die App speichert sie nicht auf dem Gerät. */

export interface MailAddress {
  name: string;
  address: string;
}

export interface MailAccount {
  email: string;
  displayName: string;
  username: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  notify: boolean;
  lastError: string;
}

export interface AccountForm {
  email: string;
  displayName: string;
  username: string;
  /** Leer beim Ändern = bisheriges Passwort behalten. */
  password: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  notify: boolean;
}

export interface MailFolder {
  path: string;
  name: string;
  special: string;
  unseen: number;
  total: number;
}

export interface MailSummary {
  uid: number;
  from: MailAddress | null;
  to: MailAddress[];
  subject: string;
  date: string;
  seen: boolean;
  hasAttachments: boolean;
}

export interface MailAttachment {
  index: number;
  filename: string;
  contentType: string;
  size: number;
}

export interface MailMessage extends MailSummary {
  cc: MailAddress[];
  replyTo: MailAddress[];
  messageId: string;
  references: string[];
  text: string;
  fromHtml: boolean;
  attachments: MailAttachment[];
}

export interface SendRequest {
  to: string;
  cc: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
  protocolIds: string[];
  attachments: { name: string; mime: string; data: string }[];
}

const q = (params: Record<string, string | number | undefined>): string => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
};

const call = async <T>(method: string, path: string, body?: unknown, binary = false, timeoutMs = 60_000): Promise<T> => request<T>(await loadConn(), method, path, body, binary, { timeoutMs });

export const mailApi = {
  account: async () => (await call<{ account: MailAccount | null }>('GET', '/api/mail/account')).account,
  /** Prüft die Zugangsdaten beim Mail-Server und speichert sie nur, wenn sie stimmen (kann einige Sekunden dauern). */
  saveAccount: (form: AccountForm) => call<{ ok: true; account: MailAccount }>('PUT', '/api/mail/account', form, false, 90_000),
  setNotify: (notify: boolean) => call<{ ok: true }>('PATCH', '/api/mail/account', { notify }),
  removeAccount: () => call<{ ok: true }>('DELETE', '/api/mail/account'),
  folders: async () => (await call<{ folders: MailFolder[] }>('GET', '/api/mail/folders')).folders,
  list: (folder: string, page: number, query: string) => call<{ total: number; pageSize: number; items: MailSummary[] }>('GET', `/api/mail/messages${q({ folder, page, q: query })}`),
  get: async (folder: string, uid: number, keepUnseen = false) => (await call<{ message: MailMessage }>('GET', `/api/mail/messages/${uid}${q({ folder, keepUnseen: keepUnseen ? 1 : undefined })}`)).message,
  /** Anhang als Base64. */
  attachment: (folder: string, uid: number, index: number) => call<string>('GET', `/api/mail/messages/${uid}/attachments/${index}${q({ folder })}`, undefined, true, 120_000),
  setSeen: (folder: string, uid: number, seen: boolean) => call<{ ok: true }>('POST', `/api/mail/messages/${uid}/seen`, { folder, seen }),
  remove: (folder: string, uid: number) => call<{ ok: true }>('DELETE', `/api/mail/messages/${uid}${q({ folder })}`),
  send: (req: SendRequest) => call<{ ok: true; messageId: string; savedCopy: boolean }>('POST', '/api/mail/send', req, false, 180_000),
};
