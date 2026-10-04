import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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

const devServer = process.env.JF_HUB_SERVER ?? 'http://localhost:8080';

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'web' ? [serviceWorker()] : [])],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // `npm run dev:web`: Web-Variante mit Hot-Reload, API und Admin-Oberfläche vom lokalen Server (server/ → npm run dev).
  server: mode === 'web' ? { proxy: { '/api': devServer, '/admin': devServer } } : undefined,
  test: { environment: 'node', setupFiles: ['./src/test-setup.ts'] },
}));
