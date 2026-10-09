/** Bytes als Base64 (ohne Data-URL-Vorspann). Arbeitet in Stücken, damit auch große Dateien nicht den Aufrufstapel sprengen. */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Base64 zurück in Bytes. Wirft bei ungültigem Base64. */
export function base64ToBytes(base64: string): Uint8Array {
  const s = atob(base64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
