import { describe, expect, it } from 'vitest';
import { checkEndpoint, isBlockedAddress, PushError } from './push.js';

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
