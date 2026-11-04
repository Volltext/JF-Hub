/** Verbindungsdaten eines Postfachs, wie sie die Mail-Schicht braucht (Passwort im Klartext, nur im Speicher). */
export interface MailConnection {
  email: string;
  username: string;
  password: string;
  imapHost: string;
  imapPort: number;
  /** true = TLS von Anfang an (Port 993), false = STARTTLS (Port 143). */
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  /** true = TLS von Anfang an (Port 465), false = STARTTLS (587). */
  smtpSecure: boolean;
}

export interface MailAddress {
  name: string;
  address: string;
}

export interface MailFolder {
  /** Pfad auf dem Server (z. B. „INBOX“, „Gesendet“). */
  path: string;
  /** Anzeigename. */
  name: string;
  /** `inbox`, `sent`, `drafts`, `trash`, `junk`, `archive` oder leer. */
  special: string;
  unseen: number;
  total: number;
}

export interface MailSummary {
  uid: number;
  from: MailAddress | null;
  to: MailAddress[];
  subject: string;
  /** ISO-Zeitpunkt oder leer. */
  date: string;
  seen: boolean;
  hasAttachments: boolean;
}

export interface MailAttachmentInfo {
  /** Laufende Nummer in der Mail (für den Abruf). */
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
  /** Nur Text: HTML-Mails werden in Text umgewandelt (kein Nachladen von Bildern, keine Skripte). */
  text: string;
  /** true, wenn der Text aus einer HTML-Mail stammt. */
  fromHtml: boolean;
  attachments: MailAttachmentInfo[];
}

export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface OutgoingMail {
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
  attachments: OutgoingAttachment[];
}

export interface ListOptions {
  /** 1 = neueste. */
  page: number;
  pageSize: number;
  query?: string;
}

export interface NewMail {
  uid: number;
  from: string;
  subject: string;
}

export interface NewMailCheck {
  uidValidity: number;
  /** Höchste UID im Posteingang (Ausgangspunkt für die nächste Prüfung). */
  maxUid: number;
  /** Neue, ungelesene Mails seit `sinceUid` (leer bei der ersten Prüfung oder geänderter Validität). */
  fresh: NewMail[];
}

/** Zugriff auf das Postfach. Die echte Umsetzung (IMAP/SMTP) steht in `imap.ts`, Tests nehmen eine Attrappe. */
export interface MailBackend {
  test(conn: MailConnection): Promise<void>;
  folders(conn: MailConnection): Promise<MailFolder[]>;
  list(conn: MailConnection, folder: string, opts: ListOptions): Promise<{ total: number; items: MailSummary[] }>;
  get(conn: MailConnection, folder: string, uid: number, markSeen: boolean): Promise<MailMessage | undefined>;
  attachment(conn: MailConnection, folder: string, uid: number, index: number): Promise<{ filename: string; contentType: string; content: Buffer } | undefined>;
  setSeen(conn: MailConnection, folder: string, uid: number, seen: boolean): Promise<void>;
  /** Verschiebt in den Papierkorb, bzw. löscht endgültig, wenn die Mail schon dort liegt. */
  remove(conn: MailConnection, folder: string, uid: number): Promise<void>;
  /** Verschickt die Mail und legt (best effort) eine Kopie im Ordner „Gesendet“ ab. */
  send(conn: MailConnection, mail: OutgoingMail): Promise<{ messageId: string; saved: boolean }>;
  checkNew(conn: MailConnection, state: { uidValidity: number | null; lastUid: number | null }): Promise<NewMailCheck>;
}
