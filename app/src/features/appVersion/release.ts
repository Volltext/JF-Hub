/**
 * Versionen und Download der Android-App (APK). Alle Teile tragen dieselbe Version (`scripts/version.mjs`): Der Server meldet sie
 * in `/api/status`, die App kennt ihre eigene (`__APP_VERSION__`). Die APK liegt am GitHub-Release `v<Version>` als
 * `JF-Hub-<Version>-release.apk` (`.github/workflows/android.yml`).
 */

export const APP_VERSION: string = __APP_VERSION__;

/** Releases-Seite; ein Fork kann beim Bauen eine eigene angeben (`VITE_RELEASES_URL`). */
export const RELEASES_URL = (import.meta.env.VITE_RELEASES_URL || 'https://github.com/Volltext/JF-Hub/releases').replace(/\/+$/, '');

/** Die APK genau dieser Version. */
export const apkUrl = (version: string): string => `${RELEASES_URL}/download/v${version}/JF-Hub-${version}-release.apk`;

interface Parsed {
  nums: [number, number, number];
  /** Vorabversion („rc.1“) oder null. */
  pre: string | null;
}

export function parseVersion(v: string): Parsed | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim());
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
}

/** Vergleicht zwei Versionen (<0: a älter, 0: gleich, >0: a neuer); null, wenn eine keine Version ist. Vorabversionen liegen vor der fertigen. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i]! - y.nums[i]!;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  // rc.2 nach rc.1: Zahlenteile als Zahlen vergleichen.
  const px = x.pre.split('.');
  const py = y.pre.split('.');
  for (let i = 0; i < Math.max(px.length, py.length); i++) {
    const p = px[i];
    const q = py[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const diff = /^\d+$/.test(p) && /^\d+$/.test(q) ? Number(p) - Number(q) : p.localeCompare(q);
    if (diff) return diff;
  }
  return 0;
}
