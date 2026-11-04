/** Voreinstellungen für gängige Anbieter: Die meisten Betreuer geben nur Adresse und Passwort ein. */

export interface Provider {
  id: string;
  label: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** Was der Anbieter vorher verlangt (steht unter dem Formular). */
  hint: string;
}

export const PROVIDERS: Provider[] = [
  { id: 'gmx', label: 'GMX', imapHost: 'imap.gmx.net', imapPort: 993, smtpHost: 'mail.gmx.net', smtpPort: 587, hint: 'In GMX unter Einstellungen → POP3/IMAP-Abruf „POP3 und IMAP Zugriff“ erlauben. Mit Zwei-Faktor-Anmeldung brauchst du ein Anwendungspasswort.' },
  { id: 'webde', label: 'WEB.DE', imapHost: 'imap.web.de', imapPort: 993, smtpHost: 'smtp.web.de', smtpPort: 587, hint: 'In WEB.DE unter Einstellungen → POP3/IMAP-Abruf „POP3 und IMAP Zugriff“ erlauben. Mit Zwei-Faktor-Anmeldung brauchst du ein Anwendungspasswort.' },
  { id: 'posteo', label: 'Posteo', imapHost: 'posteo.de', imapPort: 993, smtpHost: 'posteo.de', smtpPort: 587, hint: 'Posteo nutzt dein normales Passwort.' },
  { id: 'mailbox', label: 'mailbox.org', imapHost: 'imap.mailbox.org', imapPort: 993, smtpHost: 'smtp.mailbox.org', smtpPort: 587, hint: 'Bei aktiver Zwei-Faktor-Anmeldung brauchst du ein App-Passwort.' },
  { id: 'ionos', label: 'IONOS (1&1)', imapHost: 'imap.ionos.de', imapPort: 993, smtpHost: 'smtp.ionos.de', smtpPort: 587, hint: 'Bei IONOS-Postfächern gilt das normale Passwort des Postfachs.' },
  { id: 'tonline', label: 'T-Online', imapHost: 'secureimap.t-online.de', imapPort: 993, smtpHost: 'securesmtp.t-online.de', smtpPort: 587, hint: 'T-Online verlangt ein eigenes „E-Mail-Passwort“ (im Kundencenter einrichten).' },
  { id: 'gmail', label: 'Gmail', imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 587, hint: 'Gmail braucht ein App-Passwort (Google-Konto → Sicherheit → Bestätigung in zwei Schritten → App-Passwörter). Das normale Passwort funktioniert nicht.' },
  { id: 'outlook', label: 'Outlook.com', imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp-mail.outlook.com', smtpPort: 587, hint: 'Microsoft erlaubt Anmeldung mit Passwort nur noch eingeschränkt; bei vielen Konten funktioniert sie nicht mehr. Dann bitte ein anderes Postfach nehmen.' },
];

export const CUSTOM: Provider = { id: 'custom', label: 'Anderer Anbieter', imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 587, hint: 'Die Servernamen findest du in der Hilfe deines Anbieters (Stichwort „IMAP“ und „SMTP“). Üblich sind Port 993 (IMAP) und 587 (SMTP).' };

const DOMAINS: Record<string, string> = {
  'gmx.de': 'gmx',
  'gmx.net': 'gmx',
  'gmx.at': 'gmx',
  'gmx.ch': 'gmx',
  'gmx.com': 'gmx',
  'web.de': 'webde',
  'posteo.de': 'posteo',
  'posteo.net': 'posteo',
  'mailbox.org': 'mailbox',
  't-online.de': 'tonline',
  'magenta.de': 'tonline',
  'gmail.com': 'gmail',
  'googlemail.com': 'gmail',
  'outlook.com': 'outlook',
  'outlook.de': 'outlook',
  'hotmail.com': 'outlook',
  'hotmail.de': 'outlook',
  'live.de': 'outlook',
  'online.de': 'ionos',
  '1und1.de': 'ionos',
  'ionos.de': 'ionos',
};

/** Rät den Anbieter an der Domain der Adresse; `undefined`, wenn sie keiner Voreinstellung entspricht. */
export function guessProvider(email: string): Provider | undefined {
  const domain = email.trim().toLowerCase().split('@')[1];
  const id = domain ? DOMAINS[domain] : undefined;
  return PROVIDERS.find((p) => p.id === id);
}

export const providerById = (id: string): Provider => PROVIDERS.find((p) => p.id === id) ?? CUSTOM;

/** Welcher Voreinstellung entsprechen die gespeicherten Server? (Für die Anzeige beim Bearbeiten.) */
export function providerFor(imapHost: string, smtpHost: string): Provider {
  return PROVIDERS.find((p) => p.imapHost === imapHost && p.smtpHost === smtpHost) ?? CUSTOM;
}
