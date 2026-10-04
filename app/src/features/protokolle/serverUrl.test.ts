import { describe, expect, it } from 'vitest';
import { normalizeServerUrl } from './serverUrl';

describe('normalizeServerUrl', () => {
  it('ergänzt https und entfernt den Schrägstrich am Ende', () => {
    expect(normalizeServerUrl('protokolle.example.de/')).toEqual({ ok: true, url: 'https://protokolle.example.de' });
  });

  it('erlaubt http nur im Heimnetz', () => {
    expect(normalizeServerUrl('http://192.168.1.20:8080')).toEqual({ ok: true, url: 'http://192.168.1.20:8080' });
    expect(normalizeServerUrl('http://localhost:8099').ok).toBe(true);
    expect(normalizeServerUrl('http://example.de').ok).toBe(false);
    expect(normalizeServerUrl('http://8.8.8.8').ok).toBe(false);
  });

  it('lehnt Leeres, Unsinn und fremde Schemata ab', () => {
    expect(normalizeServerUrl('  ').ok).toBe(false);
    expect(normalizeServerUrl('ftp://x.de').ok).toBe(false);
    expect(normalizeServerUrl('https://').ok).toBe(false);
  });
});
