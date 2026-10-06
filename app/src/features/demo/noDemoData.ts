/**
 * Platzhalter für `@demo-data`, wenn `server/src/demoData.ts` fehlt (Docker-Build der Web-App). Dort wird die
 * Browser-Demo nie gebaut; der Platzhalter hält nur den Import auflösbar (siehe vite.config.ts).
 */
export const DEMO_NAMES = { jana: '', tobias: '' } as const;

export function demoData(): never {
  throw new Error('Beispieldaten fehlen (server/src/demoData.ts).');
}
