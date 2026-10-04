/** Hosts, bei denen unverschlüsseltes HTTP vertretbar ist (lokales Testen, Heimnetz). */
function isLocalHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.lan')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return host === '[::1]';
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Bereinigt die eingegebene Server-Adresse. Außerhalb des Heimnetzes ist nur HTTPS erlaubt –
 * Passwort und Protokolle dürfen nie unverschlüsselt über das Internet laufen.
 */
export function normalizeServerUrl(input: string): UrlCheck {
  let s = input.trim();
  if (!s) return { ok: false, error: 'Bitte die Server-Adresse eingeben.' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: 'Die Adresse ist ungültig.' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'Nur https:// ist erlaubt.' };
  if (u.protocol === 'http:' && !isLocalHost(u.hostname)) {
    return { ok: false, error: 'Aus Sicherheitsgründen ist außerhalb des Heimnetzes nur https:// erlaubt.' };
  }
  return { ok: true, url: u.origin + u.pathname.replace(/\/+$/, '') };
}
