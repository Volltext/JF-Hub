import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 8099;
const root = resolve(import.meta.dirname, '..');
const dataDir = process.env.E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'jfh-e2e-'));

/**
 * Rauchtest gegen den echten Server mit der gebauten Web-App (siehe docs/entwicklung.md):
 *   cd server && npm run build && cd ../app && npm run build:web
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
  webServer: {
    command: `node ${join(root, 'server/dist/index.js')}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      DATA_DIR: dataDir,
      ADMIN_USER: 'admin',
      ADMIN_PASSWORD: 'e2e-admin-passwort',
      ADMIN_DIR: join(root, 'server/public/admin'),
      WEB_DIR: join(root, 'app/dist-web'),
      NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
    },
  },
});
