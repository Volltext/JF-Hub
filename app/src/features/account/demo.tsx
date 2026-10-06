import { useEffect, useState } from 'react';
import { IS_WEB } from '@/core/env';

/** Öffentlicher Zugang einer Demo-Instanz (Server mit `DEMO=1`). */
export interface DemoAccount {
  username: string;
  password: string;
  displayName: string;
  role: 'admin' | 'betreuer';
  hint: string;
}

export interface DemoInfo {
  /** Uhrzeit des täglichen Zurücksetzens (HH:MM). */
  resetAt: string;
  accounts: DemoAccount[];
}

let cached: Promise<DemoInfo | null> | undefined;

/** Fragt den Server einmal, ob er eine Demo ist. Nur im Browser; die App spricht nie mit einer Demo-Instanz. */
export function loadDemoInfo(): Promise<DemoInfo | null> {
  if (!IS_WEB) return Promise.resolve(null);
  cached ??= fetch('/api/status')
    .then((r) => (r.ok ? (r.json() as Promise<{ demo?: DemoInfo }>) : null))
    .then((s) => s?.demo ?? null)
    .catch(() => {
      cached = undefined; // offline: beim nächsten Mal erneut fragen
      return null;
    });
  return cached;
}

export function useDemoInfo(): DemoInfo | null {
  const [info, setInfo] = useState<DemoInfo | null>(null);
  useEffect(() => {
    let alive = true;
    void loadDemoInfo().then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, []);
  return info;
}

/** Schmale Leiste über der App: Das hier ist eine Demo. */
export function DemoBanner({ info }: { info: DemoInfo }) {
  return (
    <div className="demo-banner" role="note">
      <strong>Demo</strong> · Bitte keine echten Daten eintragen. Alles wird täglich um {info.resetAt} Uhr zurückgesetzt.
    </div>
  );
}
