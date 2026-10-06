# Entwicklung

[← Dokumentation](README.md)

Für alle, die an JF Hub mitarbeiten. Wie du Fehler meldest und Code beiträgst, steht in [CONTRIBUTING.md](../CONTRIBUTING.md).

**Auf dieser Seite:** [Voraussetzungen](#voraussetzungen) · [Starten](#starten) · [Tests und Prüfungen](#tests-und-prüfungen) · [Aufbau](#aufbau) · [Abgleich](#wie-der-abgleich-funktioniert) · [Web-Push](#web-push) · [API](#api-in-kürze) · [Release](#release)

## Voraussetzungen

Node 22 (der Server nutzt das eingebaute `node:sqlite`), npm. Für die Android-App zusätzlich JDK 21 und das Android SDK ([Android-App](android-app.md)). Docker nur zum Testen des Images.

## Starten

```bash
# Terminal 1: Server auf http://localhost:8080 (Daten in server/data, Admin unter /admin/)
cd server && npm install && npm run dev

# Terminal 2: Web-App mit Hot-Reload auf http://localhost:5173 (API und /admin kommen per Proxy vom Server)
cd app && npm install && npm run dev:web
```

> [!TIP]
> Beim ersten Start steht der Setup-Code im Terminal des Servers. Damit legst du unter `http://localhost:5173/admin/` das erste Konto an.

`npm run dev` (ohne `:web`) startet die App wie in der **Android-Hülle**: lokal, ohne Anmeldung, mit PIN-Sperre und Server-Adresse in den Einstellungen. Das ist praktisch für Oberfläche und Wettkampf-Teil; der Abgleich mit dem Server geht nur über `dev:web`, weil der Server (bewusst) kein CORS erlaubt.

Die fertige PWA (Service Worker, Installation, Push) prüfst du so – der Service Worker entsteht nur im Build:

```bash
cd app && npm run build:web                       # → app/dist-web
rm -rf ../server/public/web && cp -r dist-web ../server/public/web
cd ../server && npm run dev                       # Web-App unter http://localhost:8080/
```

Das ganze Image baust du mit `docker build -t jf-hub .`.

## Tests und Prüfungen

```bash
cd app    && npm run typecheck && npm test
cd server && npm run typecheck && npm test
```

Dazu kommt ein **Rauchtest im Browser** (Playwright, Ordner `e2e/`): Er startet den echten Server mit der gebauten Web-App, meldet zwei Betreuer an, schreibt ein Protokoll, veröffentlicht es und nimmt es wieder zurück. Ein zweiter Server läuft im [Demo-Modus](demo.md) und prüft die Anmeldung per Knopf und die Beispieldaten; die [Demo im Browser](demo.md#demo-im-browser) wird wie auf GitHub Pages unter einem Unterpfad ausgeliefert und geprüft.

```bash
cd server && npm run build && cd ../app && npm run build:web && npm run build:demo     # Voraussetzung: Server, Web-App und Demo gebaut
cd ../e2e && npm ci && npx playwright install chromium && npm test
# Mit vorhandenem Chromium: PW_CHROMIUM_PATH=/pfad/zu/chrome npm test
```

Die CI (`.github/workflows/ci.yml`) führt alles aus, baut die PWA und startet das Docker-Image als Rauchtest.

Was getestet wird: Wertungslogik und Regeln (reine Funktionen), Datenbank-Schema, Abgleich (Konflikte, Sichtbarkeit, Löschhinweise), Dienst-Rhythmus, Web-Push-Client, Service Worker (in einer nachgebauten Umgebung), Server-API (Anmeldung, Benutzer, Sichtbarkeit, Push, PDF, Migration einer Alt-Datenbank).

## Aufbau

```
app/
  src/
    app/          Gerüst: Navigation (NavShell), Registrierung der Module (features.tsx), Web-Anmeldung, Android-PIN
    core/
      db/         Dexie (IndexedDB): Schema, Repos, Outbox, Sicherung, Wipe beim Abmelden
      domain/     Typen und reine Logik (Aufgaben, Dienst-Rhythmus, Zeit, Statistik)
      account/    angemeldetes Konto, Benutzerverzeichnis, Besitz/Sichtbarkeit
      push/       Web-Push-Client (Abo, Erinnerungen an den Server schicken, Service-Worker-Registrierung)
      native/     Brücke zu Capacitor-Plugins (Benachrichtigungen, Dateien, Haptik, …)
      ui/         Design-System (Komponenten, eigene Dialoge/Wähler, Tokens)
    features/     ein Ordner je Bereich: dienste, aufgaben, mitglieder, protokolle, kleidung, wettkampf, wissen, ink, attachments, account, einstellungen
    sw/           Service-Worker-Vorlage (Vite-Plugin macht daraus /sw.js)
  android/        Capacitor-Projekt mit den Java-Teilen für Handschrift
server/
  src/
    app.ts        Routen (Fastify), Anmeldung, Admin-API
    auth.ts       Benutzer, Einladungen, Passwörter, Sitzungen, Login-Bremse, Migration von Version 1
    sync.ts       Abgleich mit Besitz und Sichtbarkeit
    push.ts       Web-Push: Abos, Erinnerungen, Versand
    backup.ts     Backups (VACUUM INTO, täglich, Aufräumen) und Wiederherstellung
    pdf.ts, clothingPdf.ts, inkSvg.ts   PDF-Erzeugung
    db.ts         Schema und Migrationen (SQLite)
  public/admin/   Admin-Oberfläche (ohne Framework)
e2e/              Playwright-Rauchtest (Server + gebaute Web-App)
```

### Ein neues Modul ergänzen

`app/src/app/features.tsx` ist die **einzige** Stelle, an der Module registriert werden (Route, Navigationseintrag, „Mehr“-Eintrag). Neues Modul = neuer Ordner in `src/features/` + ein Eintrag dort.

### Konventionen

- **Dexie-Schema** nur über eine **neue** `version(n)` erweitern, bestehende nie ändern. `orderBy` nur auf indizierte Spalten (Test `schema.test.ts`).
- Keine nativen Browser-Dialoge: `confirmDialog` statt `confirm()`, die eigenen Wähler (`core/ui/pickers.tsx`) statt `<select>`, `type=date|time`.
- Regeln und Wertung (`features/wettkampf/rules`) sind reine Funktionen mit Tests – dort ändern, wenn sich Richtlinien ändern.
- Text und Oberfläche sind deutsch; Code-Kommentare ebenfalls.
- Server-Datenbank nur über additive Migrationen in `db.ts` (`addColumn`, `CREATE TABLE IF NOT EXISTS`) ändern.

## Wie der Abgleich funktioniert

- Daten liegen lokal (Dexie) und auf dem Server (SQLite). Der Client **schreibt zuerst lokal** und gleicht danach ab (beim Start, nach Änderungen, bei Netzrückkehr, jede Minute).
- **Protokolle** haben eine Server-Revision (`rev`). Eine Änderung gilt, wenn sie auf der aktuellen Revision aufbaut; sonst bleibt die Server-Fassung und die Client-Fassung wird als „(Konflikt)“-Kopie gesichert.
- **Mitglieder, Dienste, Aufgaben, Kleidung** laufen als allgemeine „Records“ (`records`-Tabelle, JSON je Eintrag): letzte Änderung gewinnt. Lokale Änderungen merkt die **Outbox** vor.
- Jede Änderung bekommt eine globale, steigende Revision. Der Client fragt „alles seit Revision X“.
- Die **Epoche** erkennt eine ausgetauschte Server-Datenbank: Passt sie nicht, lädt der Client alles neu und sendet hoch, was dem Server fehlt.
- **Sichtbarkeit:** Jeder Protokoll- und Aufgabeneintrag hat `ownerId` und `shared`. Der Server liefert nur Sichtbares (`shared = 1 OR ownerId = <ich>`). Stellt der Besitzer einen Eintrag wieder privat, merkt sich der Server die Revision (`hiddenRev`) und schickt allen anderen einen **Löschhinweis**, damit ihre lokale Kopie verschwindet. Nie veröffentlichte Einträge erzeugen keinen Hinweis.
- **Abmelden** leert die lokalen Daten (`core/db/wipe.ts`), damit ein Kontowechsel nichts vermischt.

## Web-Push

1. Der Server erzeugt beim ersten Start VAPID-Schlüssel (Tabelle `config`).
2. Die PWA fragt die Erlaubnis ab, abonniert den Browser-Push-Dienst und meldet das Abo am Server an (`/api/push/subscribe`).
3. Die App berechnet die nächsten Erinnerungen **wie für die Android-Alarme** (`planReminders`, `upcomingServices`) und schickt sie an `/api/push/reminders` (je Art vollständig ersetzt).
4. Der Server prüft alle 30 Sekunden, was fällig ist, und verschickt es (`web-push`). Abos, die der Push-Dienst nicht mehr kennt (404/410), werden entfernt. Erinnerungen, die älter als 15 Minuten sind, entfallen.
5. Der Service Worker (`src/sw/sw.template.js`) zeigt die Benachrichtigung; Antippen öffnet die App an der passenden Stelle.

Dass die Termin-Logik im Client bleibt (Ferien, Saison-Zeiten), hält den Server schlank und für Android und Web gleich.

## API in Kürze

Öffentlich: `GET /api/health`, `GET /api/status` (im Demo-Modus mit `demo: { resetAt, accounts }`), `POST /api/setup`, `/api/login`, `/api/invite/accept`.
Angemeldet (Bearer-Token oder Cookie mit `X-JFH: 1`): `/api/me`, `/api/logout`, `/api/account/{password,sessions…}`, `POST /api/sync`, `GET /api/protocols/:id/pdf`, `POST /api/clothing/pdf`, `GET /api/export.zip`, `GET /api/holidays`, `/api/push/{key,subscribe,unsubscribe,reminders,test}`.
Nur Admins: `/api/admin/{info,settings,users…,sessions…,protocols…,backup,backups…,restore,preview.pdf}`.

## Release

1. Versionen erhöhen: `app/package.json`, `app/android/app/build.gradle` (`versionCode` + `versionName`), `server/package.json`, `VERSION` in `server/src/app.ts`; `CHANGELOG.md` ergänzen.
2. Auf `main` mergen, dann den Tag auf dem Merge-Commit setzen: `git tag vX.Y.Z && git push --tags`.
3. GitHub Actions baut das Docker-Image (`ghcr.io/volltext/jf-hub:X.Y.Z`, `:X.Y`, `:latest`) und die APK und legt sie ans Release.
