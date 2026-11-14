import { describe, expect, it } from 'vitest';
import { apkUrl, compareVersions, parseVersion } from './release';

describe('Versionen', () => {
  it('vergleicht nach Zahlen, nicht nach Text', () => {
    expect(compareVersions('3.10.0', '3.9.9')).toBeGreaterThan(0);
    expect(compareVersions('3.5.0', '3.5.0')).toBe(0);
    expect(compareVersions('3.4.2', '3.5.0')).toBeLessThan(0);
    expect(compareVersions('v4.0.0', '3.99.99')).toBeGreaterThan(0);
  });

  it('ordnet Vorabversionen vor die fertige Version', () => {
    expect(compareVersions('3.5.0-rc.1', '3.5.0')).toBeLessThan(0);
    expect(compareVersions('3.5.0-rc.2', '3.5.0-rc.1')).toBeGreaterThan(0);
    expect(compareVersions('3.5.0-rc.10', '3.5.0-rc.9')).toBeGreaterThan(0);
  });

  it('erkennt Unsinn', () => {
    expect(parseVersion('dev')).toBeNull();
    expect(compareVersions('dev', '3.5.0')).toBeNull();
  });

  it('verlinkt die APK genau dieser Version am Release', () => {
    expect(apkUrl('3.5.0')).toBe('https://github.com/Volltext/JF-Hub/releases/download/v3.5.0/JF-Hub-3.5.0-release.apk');
  });
});
