/**
 * Neue eindeutige ID. `crypto.randomUUID` gibt es nur in sicheren Kontexten (HTTPS/localhost);
 * beim Zugriff per http://<Server-IP> fehlt es, daher der Fallback über getRandomValues bzw. Math.random.
 */
export const newId = (): string => {
  const c = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // Variante 10xx
  const h = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
};
/**
 * Abgeleitete ID im Format von `newId`: gleiche Teile ergeben auf jedem Gerät dieselbe ID (FNV-1a, viermal mit
 * verschiedenem Startwert). Für Kennungen, auf die sich Geräte ohne Absprache einigen müssen, nicht für Geheimnisse.
 */
export const deriveId = (...parts: string[]): string => {
  const s = parts.join('\u0000');
  const hex = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
    .map((seed) => {
      let h = seed >>> 0;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h.toString(16).padStart(8, '0');
    })
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export const nowIso = (): string => new Date().toISOString();
export const todayIso = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
