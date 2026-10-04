import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('liefert eine UUID v4', () => {
    expect(newId()).toMatch(UUID);
  });

  it('funktioniert ohne crypto.randomUUID (unsicherer Kontext, http://<IP>)', () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const a = newId();
    expect(a).toMatch(UUID);
    expect(newId()).not.toBe(a);
  });

  it('funktioniert ganz ohne crypto', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newId()).toMatch(UUID);
  });
});
