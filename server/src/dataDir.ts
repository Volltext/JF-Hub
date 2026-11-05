import { statSync, existsSync } from 'node:fs';

/**
 * Im Docker-Container überlebt nur, was in einem eingebundenen Volume liegt. Läuft der Server ohne eingebundenen Datenordner
 * (`docker run` ohne `-v`, geänderter Compose-Projektname, `down -v`), liegt `/data` in der Schicht des Containers: Beim nächsten Update
 * ist alles weg, auch Konten und Anmeldungen, und mit gesetztem `ADMIN_PASSWORD` legt der Server das Admin-Konto auf der leeren
 * Datenbank still neu an, sodass nur auffällt, dass man sich neu anmelden muss. Deshalb warnt der Start laut.
 */
export function dataDirWarning(dir: string, deps: { inContainer?: boolean; dev?: (path: string) => number | undefined } = {}): string | undefined {
  const inContainer = deps.inContainer ?? existsSync('/.dockerenv');
  if (!inContainer) return undefined;
  const dev = deps.dev ?? ((p: string) => { try { return statSync(p).dev; } catch { return undefined; } });
  const here = dev(dir);
  const root = dev('/');
  // Ein eingebundenes Volume oder Verzeichnis liegt auf einem anderen Gerät als das Wurzelverzeichnis des Containers.
  if (here === undefined || root === undefined || here !== root) return undefined;
  return `Der Datenordner ${dir} ist kein eingebundenes Volume. Alles (Konten, Anmeldungen, Protokolle) geht verloren, sobald der Container neu erstellt wird, zum Beispiel beim Update. Bitte ein Volume oder einen Ordner nach ${dir} einbinden (docs/installation.md, Abschnitt „Nach dem Update muss ich mich neu anmelden“).`;
}
