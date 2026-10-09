import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 8099;
/** Zweiter Server im Demo-Modus (tests/demo.spec.ts). */
const DEMO_PORT = 8098;
/** Demo im Browser (app/dist-demo) unter einem Unterpfad wie auf GitHub Pages (tests/browser-demo.spec.ts). */
const PAGES_PORT = 8097;
/** Eigener Server für die Protokoll-Tests (tests/protokolle.spec.ts): eigene Datenbank, und /api/login erlaubt nur 8 Versuche je 15 Minuten. */
const PROTOKOLLE_PORT = 8096;
/** Ebenso für die Editor-Tests (tests/editor.spec.ts: Tabellen, Links, Hervorhebung), damit beide Dateien das Anmelde-Limit nicht teilen. */
const EDITOR_PORT = 8095;
/** Ebenso für das gemeinsame Bearbeiten (tests/collab.spec.ts: zwei Browser an einem Protokoll). */
const COLLAB_PORT = 8094;
const root = resolve(import.meta.dirname, '..');
const dataDir = process.env.E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'jfh-e2e-'));
const demoDataDir = mkdtempSync(join(tmpdir(), 'jfh-e2e-demo-'));
const protokolleDataDir = mkdtempSync(join(tmpdir(), 'jfh-e2e-protokolle-'));
const editorDataDir = mkdtempSync(join(tmpdir(), 'jfh-e2e-editor-'));
const collabDataDir = mkdtempSync(join(tmpdir(), 'jfh-e2e-collab-'));
const files = {
  ADMIN_DIR: join(root, 'server/public/admin'),
  WEB_DIR: join(root, 'app/dist-web'),
  NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
};

/**
 * Rauchtest gegen den echten Server mit der gebauten Web-App (siehe docs/entwicklung.md):
 *   cd server && npm run build && cd ../app && npm run build:web && npm run build:demo
 *   cd e2e && npm ci && npx playwright install chromium && npm test
 * Mit PW_CHROMIUM_PATH lässt sich ein vorhandener Chromium verwenden.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'de-DE',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: `node ${join(root, 'server/dist/index.js')}`,
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { PORT: String(PORT), DATA_DIR: dataDir, ADMIN_USER: 'admin', ADMIN_PASSWORD: 'e2e-admin-passwort', ...files },
    },
    {
      command: `node ${join(root, 'server/dist/index.js')}`,
      url: `http://127.0.0.1:${PROTOKOLLE_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { PORT: String(PROTOKOLLE_PORT), DATA_DIR: protokolleDataDir, ADMIN_USER: 'admin', ADMIN_PASSWORD: 'e2e-admin-passwort', ...files },
    },
    {
      command: `node ${join(root, 'server/dist/index.js')}`,
      url: `http://127.0.0.1:${EDITOR_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { PORT: String(EDITOR_PORT), DATA_DIR: editorDataDir, ADMIN_USER: 'admin', ADMIN_PASSWORD: 'e2e-admin-passwort', ...files },
    },
    {
      command: `node ${join(root, 'server/dist/index.js')}`,
      url: `http://127.0.0.1:${COLLAB_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { PORT: String(COLLAB_PORT), DATA_DIR: collabDataDir, ADMIN_USER: 'admin', ADMIN_PASSWORD: 'e2e-admin-passwort', ...files },
    },
    {
      command: `node ${join(root, 'server/dist/index.js')}`,
      url: `http://127.0.0.1:${DEMO_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { PORT: String(DEMO_PORT), DATA_DIR: demoDataDir, DEMO: '1', ...files },
    },
    {
      command: `node ${join(root, 'e2e/static-server.mjs')} ${PAGES_PORT} /JF-Hub/demo/ ${join(root, 'app/dist-demo')}`,
      url: `http://127.0.0.1:${PAGES_PORT}/health`,
      reuseExistingServer: false,
      timeout: 10_000,
    },
  ],
});
