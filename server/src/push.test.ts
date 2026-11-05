import { describe, expect, it } from 'vitest';
import { checkEndpoint, isBlockedAddress, makeSafeLookup, PushError } from './push.js';

describe('checkEndpoint (SSRF-Schutz, erste Linie)', () => {
  it('lässt echte Push-Dienste zu', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc123',
      'https://updates.push.services.mozilla.com/wpush/v2/xyz',
      'https://web.push.apple.com/Qabc',
      'https://db5p.notify.windows.com/w/?token=AA',
    ]) {
      expect(checkEndpoint(ok)).toBe(ok);
    }
  });

  it('lehnt http, IP-Adressen (auch exotisch) und interne/reservierte Namen ab', () => {
    for (const bad of [
      'http://fcm.googleapis.com/x', // kein https
      'https://127.0.0.1/x',
      'https://2130706433/x', // dezimale IP
      'https://0x7f.1/x', // hexadezimal, mit Punkt (frühere Lücke)
      'https://[::1]/x',
      'https://localhost/x',
      'https://intern/x',
      'https://nas.local/x',
      'https://dienst.test/x',
      'https://dienst.invalid/x',
      'https://router.home/x',
      'kein-url',
      `https://${'a'.repeat(1001)}.com/x`, // zu lang
    ]) {
      expect(() => checkEndpoint(bad), bad).toThrow(PushError);
    }
  });
});

describe('isBlockedAddress (SSRF-Schutz, zweite Linie beim Verbinden)', () => {
  it('blockiert private, lokale und reservierte Adressen', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.6', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('lässt öffentliche Adressen zu', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '142.250.185.100', '2606:4700:4700::1111']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });
});

describe('makeSafeLookup (Adress-Filter beim Verbinden)', () => {
  const fake = (addresses: { address: string; family: number }[]) =>
    ((_host: string, _opts: unknown, cb: (e: null, a: typeof addresses) => void) => cb(null, addresses)) as never;
  const ask = (lookup: ReturnType<typeof makeSafeLookup>, opts: object) =>
    new Promise<{ err: Error | null; a: unknown; f?: number }>((resolve) => lookup('push.example.org', opts as never, ((err: Error | null, a: unknown, f?: number) => resolve({ err, a, f })) as never));

  it('liefert bei `all: true` eine Liste (so fragt Node 20+ mit Happy Eyeballs) – ohne interne Adressen', async () => {
    const lookup = makeSafeLookup(fake([{ address: '10.0.0.5', family: 4 }, { address: '203.0.113.7', family: 4 }, { address: '2001:db8::1', family: 6 }]));
    const r = await ask(lookup, { all: true });
    expect(r.err).toBeNull();
    expect(r.a).toEqual([{ address: '203.0.113.7', family: 4 }, { address: '2001:db8::1', family: 6 }]);
  });

  it('liefert ohne `all` eine einzelne erlaubte Adresse', async () => {
    const r = await ask(makeSafeLookup(fake([{ address: '127.0.0.1', family: 4 }, { address: '203.0.113.7', family: 4 }])), {});
    expect(r).toMatchObject({ err: null, a: '203.0.113.7', f: 4 });
  });

  it('lehnt ab, wenn der Name nur auf interne Adressen zeigt', async () => {
    const r = await ask(makeSafeLookup(fake([{ address: '192.168.1.10', family: 4 }])), { all: true });
    expect(r.err?.message).toMatch(/nicht erlaubte Adresse/);
  });

  it('net.connect versteht die Antwort (kein „Invalid IP address“)', async () => {
    const { connect } = await import('node:net');
    // 203.0.113.0/24 ist ein Dokumentationsnetz: Die Verbindung selbst darf scheitern, nur nicht an der Adressauflösung.
    const sock = connect({ host: 'push.example.org', port: 9, lookup: makeSafeLookup(fake([{ address: '203.0.113.7', family: 4 }])), timeout: 300 });
    const outcome = await new Promise<string>((resolve) => {
      sock.on('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
      sock.on('timeout', () => resolve('timeout'));
      sock.on('connect', () => resolve('connect'));
    });
    sock.destroy();
    expect(outcome).not.toBe('ERR_INVALID_IP_ADDRESS');
  });
});
