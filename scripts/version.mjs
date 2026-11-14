// Eine Versionsnummer für alles: App (PWA und APK), Server und Docker-Image.
//
//   node scripts/version.mjs 3.5.0        setzt die Version in app/ und server/ (package.json und package-lock.json)
//   node scripts/version.mjs --check      prüft, dass App und Server dieselbe Version tragen
//   node scripts/version.mjs --check v3.5.0   … und dass sie zum Release-Tag passt (CI bei Tags)
//
// Die Android-App liest ihre Version aus app/package.json (android/app/build.gradle), der Server aus server/package.json,
// die PWA bekommt sie beim Bauen (vite.config.ts). Eine Release ist also: Version setzen, CHANGELOG, Commit, Tag `v<Version>`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['app/package.json', 'app/package-lock.json', 'server/package.json', 'server/package-lock.json'];
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const text = (f) => readFileSync(root + f, 'utf8');
const read = (f) => JSON.parse(text(f));
const versions = () => Object.fromEntries(FILES.map((f) => [f, read(f).version]));

const [arg, tag] = process.argv.slice(2);

if (!arg || arg === '--help') {
  console.log('Aufruf: node scripts/version.mjs <Version> | --check [Tag]');
  process.exit(arg ? 0 : 1);
}

if (arg === '--check') {
  const found = versions();
  const distinct = [...new Set(Object.values(found))];
  if (distinct.length !== 1) {
    console.error('Die Versionen passen nicht zusammen:');
    for (const [f, v] of Object.entries(found)) console.error(`  ${f}: ${v}`);
    console.error('Mit `node scripts/version.mjs <Version>` überall gleich setzen.');
    process.exit(1);
  }
  const version = distinct[0];
  if (tag && tag.startsWith('v') && tag !== `v${version}`) {
    console.error(`Der Tag ${tag} passt nicht zur Version im Code (${version}).`);
    console.error(`Vor dem Tag: node scripts/version.mjs ${tag.slice(1)} und committen.`);
    process.exit(1);
  }
  console.log(`Version ${version}${tag ? ` passt zu ${tag}` : ''}.`);
  process.exit(0);
}

const version = arg.replace(/^v/, '');
if (!SEMVER.test(version)) {
  console.error(`„${arg}“ ist keine Version wie 3.5.0 oder 3.5.0-rc.1.`);
  process.exit(1);
}
for (const f of FILES) {
  const raw = text(f);
  const json = JSON.parse(raw);
  // Einrückung der Datei beibehalten (server/ nutzt vier Leerzeichen, app/ zwei).
  const indent = /\n( +)"/.exec(raw)?.[1].length ?? 2;
  json.version = version;
  // Im Lockfile steht die eigene Version zusätzlich beim Wurzelpaket ("").
  if (json.packages?.['']) json.packages[''].version = version;
  writeFileSync(root + f, JSON.stringify(json, null, indent) + '\n');
}
console.log(`Version ${version} gesetzt in ${FILES.join(', ')}.`);
