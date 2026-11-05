import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, parseTrustProxy, VERSION } from './app.js';
import { openDb } from './db.js';
import { dataDirWarning } from './dataDir.js';
import { loadMailKey } from './mail/crypto.js';
import { DEMO_ACCOUNTS, formatResetAt, parseResetAt } from './demo.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.DATA_DIR ?? './data');
const port = Number(process.env.PORT ?? 8080);

const demo = ['1', 'true', 'yes', 'ja'].includes((process.env.DEMO ?? '').trim().toLowerCase());

mkdirSync(dataDir, { recursive: true });
const dataWarning = dataDirWarning(dataDir);
if (dataWarning) {
  console.warn('\n==================================================');
  console.warn(` ACHTUNG: ${dataWarning}`);
  console.warn('==================================================\n');
}
const db = openDb(join(dataDir, 'jf-hub.sqlite'));
const mailOn = !['0', 'false', 'no', 'nein'].includes((process.env.MAIL_ENABLED ?? '').trim().toLowerCase());
const mailPoll = Number(process.env.MAIL_POLL_SECONDS);
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
  backupDir: process.env.BACKUP_DIR ?? join(dataDir, 'backups'),
  demo: demo ? { resetAt: process.env.DEMO_RESET_AT } : undefined,
  mail: {
    enabled: mailOn && !demo,
    // Der Schlüssel entsteht nur, wenn E-Mail an ist (sonst bliebe bei jedem Start eine unnötige Datei zurück).
    key: mailOn && !demo ? loadMailKey({ env: process.env.MAIL_KEY, file: join(dataDir, 'mail.key') }) : undefined,
    allowPrivate: ['1', 'true', 'yes', 'ja'].includes((process.env.MAIL_ALLOW_PRIVATE ?? '').trim().toLowerCase()),
    pollMs: Number.isFinite(mailPoll) && mailPoll > 0 ? mailPoll * 1000 : undefined,
  },
});

if (demo) {
  console.log('\n==================================================');
  console.log(` JF Hub Server ${VERSION}: DEMO-MODUS`);
  console.log(` Beispieldaten sind angelegt; alles wird täglich um ${formatResetAt(parseResetAt(process.env.DEMO_RESET_AT))} zurückgesetzt.`);
  console.log(` Zugänge: ${DEMO_ACCOUNTS.map((a) => `${a.username} / ${a.password}`).join(', ')}`);
  console.log('==================================================\n');
}

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
