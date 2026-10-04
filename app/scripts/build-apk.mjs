// Baut die signierte Release-APK: Web-Build → Capacitor-Sync → Gradle → Kopie nach apk/.
// Aufruf: npm run apk            (Release, benötigt android/keystore.properties)
//         npm run apk -- debug   (Debug-APK ohne eigene Signatur)
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const debug = process.argv[2] === 'debug';
const isWin = process.platform === 'win32';

// JDK: vorhandenes JAVA_HOME nutzen, sonst das mitgelieferte von Android Studio versuchen.
const jbr = 'C:/Program Files/Android/Android Studio/jbr';
const env = { ...process.env };
if (!env.JAVA_HOME && existsSync(jbr)) env.JAVA_HOME = jbr;
if (!env.JAVA_HOME) {
  console.error('JAVA_HOME ist nicht gesetzt und Android Studio wurde nicht gefunden.');
  process.exit(1);
}

const run = (cmd, args, cwd = '.') => {
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!debug && !existsSync('android/keystore.properties')) {
  console.error('android/keystore.properties fehlt – ohne Schlüssel lässt sich keine Release-APK signieren.');
  process.exit(1);
}

run('npm', ['run', 'build']);
run('npx', ['cap', 'sync', 'android']);
run(isWin ? '.\\gradlew.bat' : './gradlew', [debug ? 'assembleDebug' : 'assembleRelease'], 'android');

const variant = debug ? 'debug' : 'release';
const built = join('android/app/build/outputs/apk', variant, `app-${variant}.apk`);
if (!existsSync(built)) {
  console.error(`APK nicht gefunden: ${built}`);
  process.exit(1);
}
const version = /versionName "([^"]+)"/.exec(readFileSync('android/app/build.gradle', 'utf8'))?.[1] ?? '0';
mkdirSync('apk', { recursive: true });
const target = join('apk', `JF-Hub-${version}-${variant}.apk`);
copyFileSync(built, target);
console.log(`\nFertig: ${target}`);
