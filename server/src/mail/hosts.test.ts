import { describe, expect, it } from 'vitest';
import { cleanHost, cleanPort, IMAP_PORTS, MailHostError, resolveMailHost, SMTP_PORTS } from './hosts.js';

describe('Mail-Server prüfen (SSRF-Schutz)', () => {
  it('lässt nur übliche Mail-Ports zu', () => {
    expect(cleanPort(993, IMAP_PORTS, 'IMAP')).toBe(993);
    expect(cleanPort('587', SMTP_PORTS, 'SMTP')).toBe(587);
    for (const bad of [22, 80, 3306, 6379, 'abc', 0, 993.5]) expect(() => cleanPort(bad, IMAP_PORTS, 'IMAP'), String(bad)).toThrow(MailHostError);
  });

  it('akzeptiert Namen und IPs, lehnt Unsinn ab', () => {
    expect(cleanHost(' IMAP.GMX.net ')).toBe('imap.gmx.net');
    expect(cleanHost('8.8.8.8')).toBe('8.8.8.8');
    for (const bad of ['', 'localhost', 'intern', 'a b.de', 'http://x.de', 'x.de/pfad', 'x.de:993', undefined, 5]) expect(() => cleanHost(bad), String(bad)).toThrow(MailHostError);
  });

  it('löst auf und verbindet mit der geprüften Adresse', async () => {
    const r = await resolveMailHost('imap.gmx.net', { resolver: async () => [{ address: '212.227.17.168', family: 4 }] });
    expect(r).toEqual({ ip: '212.227.17.168', servername: 'imap.gmx.net' });
  });

  it('blockiert Namen, die auf interne Adressen zeigen (auch gemischt: es zählt die erlaubte Adresse)', async () => {
    const internal = async () => [{ address: '192.168.1.5', family: 4 }];
    await expect(resolveMailHost('mail.example.org', { resolver: internal })).rejects.toThrow(/internen Netz/);
    await expect(resolveMailHost('127.0.0.1')).rejects.toThrow(/internen Netz/);
    await expect(resolveMailHost('169.254.169.254')).rejects.toThrow(/internen Netz/);
    const mixed = async () => [{ address: '10.0.0.1', family: 4 }, { address: '93.184.216.34', family: 4 }];
    expect((await resolveMailHost('mail.example.org', { resolver: mixed })).ip).toBe('93.184.216.34');
  });

  it('erlaubt interne Adressen nur auf ausdrücklichen Wunsch', async () => {
    expect((await resolveMailHost('192.168.1.5', { allowPrivate: true })).ip).toBe('192.168.1.5');
  });

  it('meldet unbekannte Namen verständlich', async () => {
    await expect(resolveMailHost('gibt-es-nicht.example.org', { resolver: async () => { throw new Error('ENOTFOUND'); } })).rejects.toThrow(/nicht gefunden/);
  });
});
