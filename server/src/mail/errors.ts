import { MailKeyError } from './crypto.js';
import { MailHostError } from './hosts.js';

/** Eingabe des Betreuers ist ungültig (Adresse, Port, Größe …): Antwort 400 mit dieser Meldung. */
export class MailInputError extends Error {}

export interface FriendlyError {
  status: number;
  message: string;
}

/** Übersetzt Fehler von IMAP, SMTP und Netz in verständliche Meldungen. Das Passwort steht nie darin. */
export function friendlyMailError(e: unknown): FriendlyError {
  if (e instanceof MailInputError) return { status: 400, message: e.message };
  if (e instanceof MailHostError) return { status: 400, message: e.message };
  if (e instanceof MailKeyError) return { status: 409, message: e.message };
  const err = e as { code?: string; authenticationFailed?: boolean; responseStatus?: string; responseText?: string; message?: string; response?: string };
  if (err?.authenticationFailed || err?.code === 'EAUTH' || err?.responseStatus === 'NO' && /auth|login|credentials|password/i.test(err.responseText ?? ''))
    return { status: 502, message: 'Die Anmeldung beim Postfach ist fehlgeschlagen. Bitte Benutzername und Passwort prüfen (bei GMX und WEB.DE: „POP3/IMAP-Zugriff“ aktivieren, bei Zwei-Faktor ein Anwendungspasswort verwenden).' };
  switch (err?.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { status: 502, message: 'Der Mail-Server wurde nicht gefunden. Bitte den Servernamen prüfen.' };
    case 'ECONNREFUSED':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return { status: 502, message: 'Der Mail-Server ist nicht erreichbar. Bitte Servername und Port prüfen.' };
    case 'ETIMEDOUT':
    case 'ESOCKET':
    case 'ECONNECTION':
    case 'ETIMEOUT':
      return { status: 502, message: 'Der Mail-Server antwortet nicht (Zeitüberschreitung). Bitte später noch einmal versuchen.' };
    case 'ECONNRESET':
      return { status: 502, message: 'Die Verbindung zum Mail-Server wurde unterbrochen.' };
    case 'EENVELOPE':
      return { status: 400, message: 'Die Empfänger-Adresse wurde vom Mail-Server abgelehnt.' };
  }
  if (/certificate|self[- ]signed|CERT_|ERR_TLS|SSL/i.test(String(err?.code ?? '') + String(err?.message ?? '')))
    return { status: 502, message: 'Die verschlüsselte Verbindung konnte nicht bestätigt werden (Zertifikat des Mail-Servers ungültig).' };
  if (/STARTTLS/i.test(String(err?.message ?? ''))) return { status: 502, message: 'Der Mail-Server bietet keine verschlüsselte Verbindung (STARTTLS) an. Bitte Port 993 (IMAP) und 587 oder 465 (SMTP) verwenden.' };
  const reply = String(err?.response ?? err?.responseText ?? '').trim();
  if (/^5\d\d/.test(reply) || err?.responseStatus === 'NO' || err?.responseStatus === 'BAD') return { status: 502, message: `Der Mail-Server hat die Anfrage abgelehnt${reply ? `: ${reply.replace(/\s+/g, ' ').slice(0, 160)}` : '.'}` };
  if (e instanceof Error && /zu groß/.test(e.message)) return { status: 413, message: e.message };
  return { status: 502, message: 'Das Postfach konnte nicht abgefragt werden.' };
}
