/**
 * Ziele von Links im Protokoll. Eine einzige Allowlist (http, https, mailto, tel) gilt für die Eingabe, die Anzeige, das Einfügen und
 * das PDF; alles andere (javascript:, data:, file:, relative Adressen …) wird nie als Link gesetzt, angezeigt oder geöffnet.
 */

const MAX_LENGTH = 2000;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAIL = /^[^\s@/:?#]+@[^\s@/:?#]+\.[A-Za-z]{2,}$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[/?#].*)?$/;

function webTarget(url: string): boolean {
  // Die Adresse nach „//“ darf nicht leer sein („https://“, „https:///pfad“) und nicht mit „@“ oder „\“ beginnen.
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  if (!m || m[1]!.startsWith('@') || m[1]!.includes('\\')) return false;
  try {
    return new URL(url).hostname.length > 0;
  } catch {
    return false;
  }
}

/** Ist das ein Ziel, das der Editor setzt, anzeigt und öffnet? Nur http(s), mailto und tel, ohne Leerzeichen, höchstens 2000 Zeichen. */
export function allowedLink(url: unknown): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_LENGTH) return false;
  if (/\s/.test(url) || CONTROL.test(url)) return false; // auch führende Leerzeichen: So werden Schemata getarnt
  if (/^https?:\/\//i.test(url)) return webTarget(url);
  if (/^mailto:/i.test(url)) return url.length > 'mailto:'.length;
  if (/^tel:/i.test(url)) return /^tel:\+?[0-9().-]*[0-9][0-9().-]*$/i.test(url);
  return false;
}

/** „+49 (170) 123-45 67“ → „+491701234567“, oder null, wenn das keine Telefonnummer ist (ab drei Ziffern, damit 110 und 112 gehen). */
function phoneDigits(raw: string): string | null {
  const p = raw.replace(/[\s()./-]/g, '');
  return /^\+?[0-9]{3,15}$/.test(p) ? p : null;
}

/**
 * Macht aus einer Eingabe ein erlaubtes Link-Ziel: ergänzt https:// bei Webadressen, mailto: bei E-Mail-Adressen und tel: bei
 * Telefonnummern. Alles, was nicht eindeutig ein erlaubtes Ziel ist, liefert null.
 */
export function normalizeUrl(input: string): string | null {
  const s = input.trim();
  if (!s || s.length > MAX_LENGTH || CONTROL.test(s)) return null;

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (scheme) {
    const name = scheme[1]!.toLowerCase();
    const rest = s.slice(scheme[0].length);
    if (name === 'http' || name === 'https') return allowedLink(s) ? s : null;
    if (name === 'mailto') return allowedLink(s) && MAIL.test(rest.split('?')[0]!) ? s : null;
    if (name === 'tel') {
      const digits = phoneDigits(rest);
      return digits ? `tel:${digits}` : null;
    }
    // „localhost:8080“ und „beispiel.de:8080/x“ sind Webadressen mit Anschluss, alles andere mit Schema („javascript:“, „data:“,
    // „file:“, „ftp:“ …) ist unzulässig.
    if (!/^\d{1,5}(?:[/?#]|$)/.test(rest)) return null;
  }

  // Ziffern mit Leerzeichen, Klammern, Strichen oder Schrägstrich sind eine Telefonnummer (ohne Punkte: „12.10.2026“ ist ein Datum).
  if (!IPV4.test(s) && /^\+?\(?[0-9][0-9\s()/-]{2,}$/.test(s)) {
    const digits = phoneDigits(s);
    return digits ? `tel:${digits}` : null;
  }
  if (/\s/.test(s)) return null;
  // Nur Ziffern und Punkte, aber keine IP-Adresse („12“, „1.2.3“): Die URL-Klasse machte daraus „https://0.0.0.12“.
  if (/^[\d.]+(?::\d+)?(?:[/?#].*)?$/.test(s) && !IPV4.test(s)) return null;
  if (MAIL.test(s)) return `mailto:${s}`;
  if (/^[/#?.@\\]/.test(s)) return null; // relative Adressen, Anker, Anfragen

  const candidate = `https://${s}`;
  if (!allowedLink(candidate)) return null;
  const host = new URL(candidate).hostname;
  return host.includes('.') || host === 'localhost' ? candidate : null;
}

/** Kurze Anzeige eines Ziels für die Link-Leiste: Host und Pfad ohne Schema, Adresse bei mailto, Nummer bei tel. */
export function displayUrl(url: string, max = 40): string {
  let shown = url.trim();
  if (/^mailto:/i.test(shown)) shown = shown.slice('mailto:'.length).split('?')[0]!;
  else if (/^tel:/i.test(shown)) shown = shown.slice('tel:'.length);
  else if (/^https?:\/\//i.test(shown)) shown = shown.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/[?#].*$/, '').replace(/\/$/, '');
  return shown.length > max ? `${shown.slice(0, max - 1)}…` : shown;
}
