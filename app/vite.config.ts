import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Web-Build (PWA): erzeugt nach dem Bauen `sw.js` aus `src/sw/sw.template.js` mit der Liste aller Dateien zum Vorladen.
 * Der Service Worker macht die App offline-fähig, installierbar und empfängt Web-Push.
 */
function serviceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'jfhub-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push('/' + relative(outDir, full).split('\\').join('/'));
        }
      };
      walk(outDir);
      const precache = files.filter((f) => f !== '/sw.js').sort();
      const hash = createHash('sha256');
      for (const f of precache) hash.update(f).update(readFileSync(join(outDir, f)));
      const template = readFileSync(new URL('./src/sw/sw.template.js', import.meta.url), 'utf8');
      const sw = template.replace('__BUILD_VERSION__', `${version}-${hash.digest('hex').slice(0, 10)}`).replace('__PRECACHE__', JSON.stringify(['/', ...precache], null, 0));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

/** Browser-Demo: ohne Manifest, damit niemand die Demo „installiert“ (Start-Adresse und Offline-Betrieb gehören zur echten App). */
function noManifest(): Plugin {
  return { name: 'jfhub-demo-no-manifest', transformIndexHtml: (html) => html.replace(/\s*<link rel="manifest"[^>]*>/, '') };
}

const devServer = process.env.JF_HUB_SERVER ?? 'http://localhost:8080';

/**
 * Beispieldaten der Browser-Demo: dieselbe Quelle wie die Server-Demo. Beim Docker-Build der Web-App fehlt der Server-Ordner;
 * dort wird die Demo nicht gebaut, ein Platzhalter hält den Import auflösbar.
 */
const demoData = fileURLToPath(new URL('../server/src/demoData.ts', import.meta.url));
const demoDataOrStub = existsSync(demoData) ? demoData : fileURLToPath(new URL('./src/features/demo/noDemoData.ts', import.meta.url));

export default defineConfig(({ mode }) => ({
  // Die Browser-Demo liegt in einem Unterordner der Website (…/JF-Hub/demo/): relative Pfade, kein Service Worker.
  base: mode === 'demo' ? './' : '/',
  plugins: [react(), ...(mode === 'web' ? [serviceWorker()] : []), ...(mode === 'demo' ? [noManifest()] : [])],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // `dedupe`: Die Tests importieren Code aus server/src (eigene Kopie von Yjs in server/node_modules). Zwei Kopien würden sich nicht erkennen.
  resolve: { alias: { '@demo-data': demoDataOrStub, '@': fileURLToPath(new URL('./src', import.meta.url)) }, dedupe: ['yjs'] },
  // `npm run dev:web`: Web-Variante mit Hot-Reload, API und Admin-Oberfläche vom lokalen Server (server/ → npm run dev).
  // `npm run dev:demo`: Browser-Demo; sie liest die Beispieldaten aus server/src.
  server:
    mode === 'web' ? { proxy: { '/api': devServer, '/admin': devServer } } : mode === 'demo' ? { fs: { allow: ['.', dirname(demoData)] } } : undefined,
  test: { environment: 'node', setupFiles: ['./src/test-setup.ts'] },
}));
