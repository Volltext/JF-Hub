import { allowedLink } from './linkUrl';

/**
 * Öffnet einen Link eines Protokolls außerhalb der App: Webadressen im Browser, E-Mail-Adressen im Mailprogramm, Telefonnummern in
 * der Telefon-App. Nur erlaubte Ziele (`allowedLink`); alles andere tut nichts.
 *
 * In der Android-App reicht der Browser-Weg: Die WebView von Capacitor reicht jede Adresse außerhalb der App an das System weiter
 * (so öffnet auch „Server-Verwaltung öffnen“ in den Einstellungen).
 */
export function openLink(url: string): void {
  if (!allowedLink(url)) return;
  if (/^https?:/i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
  else window.location.href = url; // mailto: und tel: übergibt der Browser an die passende App, ohne die Seite zu verlassen
}
