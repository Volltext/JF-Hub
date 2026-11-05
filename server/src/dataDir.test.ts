import { describe, expect, it } from 'vitest';
import { dataDirWarning } from './dataDir.js';

describe('dataDirWarning', () => {
  it('warnt, wenn der Datenordner im Container auf demselben Gerät wie / liegt (kein Volume)', () => {
    expect(dataDirWarning('/data', { inContainer: true, dev: () => 64768 })).toMatch(/kein eingebundenes Volume/);
  });
  it('schweigt bei eingebundenem Volume (anderes Gerät)', () => {
    expect(dataDirWarning('/data', { inContainer: true, dev: (p) => (p === '/' ? 1 : 2) })).toBeUndefined();
  });
  it('schweigt außerhalb von Docker und wenn sich nichts feststellen lässt', () => {
    expect(dataDirWarning('/data', { inContainer: false, dev: () => 1 })).toBeUndefined();
    expect(dataDirWarning('/data', { inContainer: true, dev: () => undefined })).toBeUndefined();
  });
});
