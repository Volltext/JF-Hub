/**
 * Strukturelle Gleichheit für JSON-artige Werte (Texte, Zahlen, Wahrheitswerte, null, Listen, einfache Objekte).
 * Schlüssel mit dem Wert `undefined` zählen wie fehlende, so wie es JSON auch tut.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in b && jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
