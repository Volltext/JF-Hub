import { secure } from '@/core/native/secure';

const K_HASH = 'pin.hash';
const K_SALT = 'pin.salt';
const ITER = 150_000;

const toHex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function derive(pin: string, saltHex: string): Promise<string> {
  const salt = Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER },
    key,
    256,
  );
  return toHex(bits);
}

export const pin = {
  async isSet(): Promise<boolean> {
    return (await secure.get(K_HASH)) !== null;
  },
  async set(value: string): Promise<void> {
    if (!/^\d{4,6}$/.test(value)) throw new Error('PIN: 4–6 Ziffern');
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
    await secure.set(K_SALT, salt);
    await secure.set(K_HASH, await derive(value, salt));
  },
  async verify(value: string): Promise<boolean> {
    const [hash, salt] = await Promise.all([secure.get(K_HASH), secure.get(K_SALT)]);
    if (!hash || !salt) return true;
    return (await derive(value, salt)) === hash;
  },
  async clear(): Promise<void> {
    await secure.remove(K_HASH);
    await secure.remove(K_SALT);
  },
};
