import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from './base64';

describe('Base64', () => {
  it('Roundtrip erhält beliebige Bytes', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('kennt die Standardbeispiele', () => {
    expect(bytesToBase64(new TextEncoder().encode('Hallo'))).toBe('SGFsbG8=');
    expect(new TextDecoder().decode(base64ToBytes('SGFsbG8='))).toBe('Hallo');
    expect(bytesToBase64(new Uint8Array())).toBe('');
  });

  it('schafft auch Dateien, die größer sind als ein Stück', () => {
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) % 251);
    const back = base64ToBytes(bytesToBase64(big));
    expect(back.length).toBe(big.length);
    expect(back[123_456]).toBe(big[123_456]);
    expect(back[big.length - 1]).toBe(big[big.length - 1]);
  });
});
