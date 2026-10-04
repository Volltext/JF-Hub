import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, parseTrustProxy, VERSION } from './app.js';
import { openDb } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DATA_DIR ?? './data');
const port = Number(process.env.PORT ?? 8080);

const db = openDb(join(dataDir, 'jf-hub.sqlite'));
const app = await buildApp({
  db,
  logger: true,
  adminDir: process.env.ADMIN_DIR ?? resolve(here, '../public/admin'),
  webDir: process.env.WEB_DIR ?? resolve(here, '../public/web'),
  adminUser: process.env.ADMIN_USER,
  adminPassword: process.env.ADMIN_PASSWORD,
  resetPassword: process.env.ADMIN_PASSWORD_RESET === '1',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  pushSubject: process.env.PUSH_SUBJECT,
});

if (app.setupCode) {
  console.log('\n==================================================');
  console.log(` JF Hub Server ${VERSION}: Ersteinrichtung nötig.`);
  console.log(` Öffne /admin/ im Browser und gib diesen Setup-Code ein:`);
  console.log(`   ${app.setupCode}`);
  console.log('==================================================\n');
}

const stop = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await app.listen({ port, host: '0.0.0.0' });
