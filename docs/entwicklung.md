# Entwicklung

[← Dokumentation](README.md)

Für alle, die an JF Hub mitarbeiten. Wie du Fehler meldest und Code beiträgst, steht in [CONTRIBUTING.md](../CONTRIBUTING.md).

**Auf dieser Seite:** [Voraussetzungen](#voraussetzungen) · [Starten](#starten) · [Tests und Prüfungen](#tests-und-prüfungen) · [Aufbau](#aufbau) · [Abgleich](#wie-der-abgleich-funktioniert) · [Gemeinsames Bearbeiten](#gemeinsames-bearbeiten-yjs) · [Editor](#der-editor-und-sein-dokumentformat) · [Web-Push](#web-push) · [API](#api-in-kürze) · [Release](#release)

## Voraussetzungen

Node ≥ 22.13 (der Server nutzt das eingebaute `node:sqlite`, das ab dieser Version ohne Flag läuft; die App-Tests laden es ebenfalls), npm. Für die Android-App zusätzlich JDK 21 und das Android SDK ([Android-App](android-app.md)). Docker nur zum Testen des Images.

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

Dazu kommt ein **Rauchtest im Browser** (Playwright, Ordner `e2e/`): Er startet den echten Server mit der gebauten Web-App, meldet zwei Betreuer an, schreibt ein Protokoll, veröffentlicht es und nimmt es wieder zurück. Ein zweiter Server läuft im [Demo-Modus](demo.md) und prüft die Anmeldung per Knopf und die Beispieldaten; die [Demo im Browser](demo.md#demo-im-browser) wird wie auf GitHub Pages unter einem Unterpfad ausgeliefert und geprüft. Ein dritter Server (Port 8096, eigene Daten) gehört `e2e/tests/protokolle.spec.ts`: Öffnen verändert nichts, Papierkorb, Fotos als Anhänge, Schutz vor unbekannten Editor-Inhalten und der Zugriffsschutz der Routen. Ein vierter (Port 8095) gehört `e2e/tests/editor.spec.ts`: Tabellen, Links und Hervorhebung im Browser (Einfügen, Tabellen- und Link-Leiste, Einfügen aus anderen Programmen, Handy-Breite, PDF) und ein Protokoll mit absurder Zellspanne. Ein fünfter (Port 8094) gehört `e2e/tests/collab.spec.ts`: Zwei Browser schreiben gleichzeitig und sehen sich („Ben ist auch hier“), ein Gerät schreibt ohne Netz weiter und gleicht danach ohne „(Konflikt)“-Kopie ab, ein ohne Netz angelegtes Protokoll kommt mit seinem Text beim anderen an, Öffnen und Zurück verändert auch ein Protokoll mit Foto am Ende und Adresse im Text nicht, und wird die Datenbank des Servers ersetzt, während jemand schreibt, bleibt dessen ungesendeter Text als Kopie erhalten. Die Server sind getrennt, weil die Anmeldung je Adresse begrenzt ist (8 je 15 Minuten) und die Dateien sie sich sonst gegenseitig aufbrauchen. Deshalb melden sich die Tests über `e2e/tests/helpers.ts` je Person nur einmal an und bekommen danach jeweils einen frischen Browser mit derselben Sitzung.

```bash
cd server && npm run build && cd ../app && npm run build:web && npm run build:demo     # Voraussetzung: Server, Web-App und Demo gebaut
cd ../e2e && npm ci && npx playwright install chromium && npm test
# Mit vorhandenem Chromium: PW_CHROMIUM_PATH=/pfad/zu/chrome npm test
```

Die CI (`.github/workflows/ci.yml`) führt alles aus, baut die PWA und startet das Docker-Image als Rauchtest.

Was getestet wird: Wertungslogik und Regeln (reine Funktionen), Datenbank-Schema, Abgleich (Kopfdaten Feld für Feld, Sichtbarkeit, Löschhinweise), Dienst-Rhythmus, Web-Push-Client, Service Worker (in einer nachgebauten Umgebung), Server-API (Anmeldung, Benutzer, Sichtbarkeit, Push, PDF, Migration einer Alt-Datenbank), Anhänge (Hochladen und Zugriff, Auslagern aus dem Inhalt, Migration, Müllsammlung, PDF und ZIP mit Fotos), Editor-Schema und Link-Regeln, PDF mit Tabellen, Links und feindlichen Eingaben, das gemeinsame Bearbeiten (Konverter gegen `@tiptap/y-tiptap`, Austausch, Sitzung, Umstellung des Bestands, Zwei-Geräte-Szenarien).

Zwei Tests haben eine besondere Rolle:

- **`server/src/security.test.ts`** sammelt über einen `onRoute`-Hook alle Routen des Servers und prüft für jede nicht öffentliche, dass sie ohne Anmeldung 401 liefert (`/api/admin/*` für Betreuer 403), auch bei abweichender Schreibweise des Pfads. Eine neue Route ist damit automatisch abgedeckt; sie muss nur ein Muster haben, das zur Zugriffsregel passt.
- **`app/src/features/protokolle/twoClients.test.ts`** lässt zwei Geräte (zwei Dexie-Datenbanken) gegen das **echte** `applySync` und den **echten** Austausch des Servers laufen (`collab/harness.ts`: `TestServer`, `newDevice`), Anhänge eingeschlossen (`checkUpload`, `findBlob`: dieselben Regeln für Prüfung und Zugriff wie im Server). Die App-Tests importieren dafür Code aus `server/src`; das Docker-Image ist davon nicht betroffen (die Web-App baut Vite und bündelt nur, was die App importiert; `*.test.ts` liegt in `.dockerignore`, `harness.ts` importieren nur Tests, und der App-Code selbst importiert nie etwas aus `server/`, das im Build-Kontext der Web-App fehlt). Beide Seiten laden `yjs` aus verschiedenen Ordnern; `resolve.dedupe: ['yjs']` in `app/vite.config.ts` sorgt in den Tests dafür, dass es nur eine Kopie gibt (sonst „Yjs was already imported“ und fehlschlagende `instanceof`-Prüfungen).
- **`app/src/features/protokolle/collab/golden.test.ts`** (Golden-Test) prüft den schema-freien Konverter des Servers (`server/src/collab/convert.ts`) gegen `@tiptap/y-tiptap` mit dem echten Editor-Schema (`getSchema(EXTENSIONS)`): Beide müssen aus demselben Dokument dieselbe Struktur bauen und lesen, in beide Richtungen und nach dem Zusammenführen, für einen Korpus aus allen Knoten, Markierungen und Altformen (auch die Demo-Daten). Er hält fest, dass das Laden eines Dokuments kein Update erzeugt (`updateYFragment` auf dem geladenen Baum schreibt nichts) und dass keine unserer Markierungen überlappt (y-tiptap legt sonst `name--hash`-Attribute an). Ändert sich eine Bibliothek oder das Vokabular, schlägt er an.

## Aufbau

```
app/
  src/
    app/          Gerüst: Navigation (NavShell), Registrierung der Module (features.tsx), Web-Anmeldung, Android-PIN
    core/
      db/         Dexie (IndexedDB): Schema, Repos, Outbox, Anhang-Speicher (`blobs`), Sicherung, Wipe beim Abmelden
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
    sync.ts       Abgleich der Kopfdaten mit Besitz und Sichtbarkeit
    versions.ts   Schnittstelle (`API_VERSION`) und kleinstes Dokumentformat (`MIN_SCHEMA`)
    collab/       Text als Yjs-Dokument: Konverter (`convert.ts`), Austausch (`exchange.ts`), Mitschreibende (`peers.ts`), Umstellung des Bestands (`migrate.ts`)
    blobs.ts      Fotos und Dateien: Speicher, Zugriff, Prüfung beim Hochladen, Auslagern aus dem Inhalt, Aufräumen
    migrate.ts    Einmaliger Umbau: Anhänge aus alten Protokollen in Blobs (beim Start und beim Einspielen alter Backups)
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
- **Protokolle** bestehen aus zwei Teilen. Die **Kopfdaten** (`title`, `datum`, `beginn`, `ende`, `ort`, `leitung`, `folderId`, `shared`) gehen mit `POST /api/sync`, und zwar **Feld für Feld**: Der Client schickt jedes Feld mit seiner Änderungszeit (`metaAt`; `repo.save` stempelt die geänderten Felder, `stampMeta` streng steigend), der Server behält je Feld die jüngere Änderung, bei Gleichstand den größeren Wert (damit alle Replikate gleich entscheiden), klemmt Zeiten auf „jetzt + 5 Minuten“ (eine Uhr in der Zukunft gewänne sonst jede spätere Änderung) und liefert die Zeiten zurück. War der Server bei einem Feld neuer, geht das Protokoll in die Antwort (`resend`), und das Gerät übernimmt es (`mergeHeader`); eine lokal jüngere Änderung bleibt vorgemerkt (`dirty`) und geht im nächsten Lauf hoch. `shared` ändert nur der Besitzer. Der **Text** ist ein Yjs-Dokument und geht über `POST /api/collab/exchange` ([Gemeinsames Bearbeiten](#gemeinsames-bearbeiten-yjs)); `/api/sync` überträgt ihn nicht mehr. Das Anfragefeld heißt `protocols` (bis 2.3.x `changes`): Ein älterer Server ignoriert es und schreibt nichts, statt Protokolle mit leerem Text anzulegen (die Prüfung von `api` in der Antwort käme zu spät). `baseRev` steht noch im Format, der Server wertet es nicht mehr aus. Konfliktkopien entstehen nicht mehr; `conflicts` bleibt als leere Liste im Format, und `conflicts.ts` zeigt weiter die Karte „Gleichzeitig bearbeitet“ für Kopien aus früheren Versionen (gemerkt in `kv 'protokolle.conflicts'`).
- **Löschen gewinnt:** Löscht der Besitzer oder der Admin ein Protokoll, setzt sich das auch gegen eine Bearbeitung auf veralteter Basis durch; eine Änderung holt ein gelöschtes oder geleertes Protokoll nur zurück, wenn sie jünger ist als das Löschen (sonst geht es als gelöscht an das Gerät zurück). Gelöschte Protokolle liegen `trashDays` im Papierkorb (`GET /api/protocols/trash`, `POST /api/protocols/:id/restore`); danach leert `purgeProtocol` Titel, Inhalt und den Yjs-Zustand (`ydocs`) und lässt einen Grabstein (`purgedAt`, neue Revision) stehen, den `sweepTrash` erst nach `max(tokenDays, 90)` Tagen entfernt. So lässt ein Gerät, das lange kein Netz hatte, nichts wiederauferstehen. Ein Gerät, das einen Text ungesendet hat, dessen Protokoll gelöscht oder zurückgezogen wurde, sichert ihn vorher als eigenes Protokoll „… (lokale Fassung)“ (`saveLocalCopy`).
- **Fehlerisolation:** Jede Änderung läuft in einem `SAVEPOINT`, beim Austausch jedes Dokument für sich. Was der Server nicht annehmen kann (zu groß, zu tief verschachtelt, kein gültiges Dokument), steht in `rejected` der Antwort (beim Austausch als Status `rejected` mit `reason`); alles andere gilt. Der Client markiert das Protokoll (`rejected`, Chip „abgelehnt“; beim Text die Meldung im Editor) und schickt es erst wieder, wenn es geändert wurde.
- **Übernehmen:** Die Antwort enthält die Protokolle seit dem Cursor (`since`). Die Kopfdaten werden Feld für Feld zusammengeführt (`mergeHeader`); eine lokal jüngere Änderung bleibt vorgemerkt, deshalb muss der Cursor nicht vor übersprungenen Dokumenten anhalten. Der Schnappschuss des Textes (`content`) ersetzt den lokalen nur, wenn hier nichts Ungesendetes und kein Editor offen ist. Danach tauscht `performSync` den Text aus: offene Editoren sofort (`exchangeNow`), alle anderen Protokolle über `exchangeInBackground`. Steht noch Text aus (mehr, als ein Lauf fasst) oder wurde die Datenbank mitten im Lauf ersetzt, läuft `syncNow` gleich noch einmal.
- **Handshake:** Jede Anfrage trägt `X-JFH-Client` (App-Version) und `X-JFH-Schema` (Stand des Dokumentformats, `features/protokolle/schemaVersion.ts`). Der Server nennt in `/api/status` und in der Abgleich-Antwort `api` und `minSchema` und weist Apps unterhalb von `MIN_SCHEMA` mit 426 („Bitte die App aktualisieren“) ab; die App prüft umgekehrt `api >= MIN_SERVER_API`. **Regel seit 3.0.0:** Wer das Vokabular des Editors ändert (Knoten, Markierungen, Attribute), erhöht im selben Release `SCHEMA_VERSION` und `MIN_SERVER_API` (App) sowie `MIN_SCHEMA` und `API_VERSION` (`server/src/versions.ts`). `editorSchema.test.ts` koppelt die Zahlen (es importiert `versions.ts`) und hält das Vokabular fest. Der Grund: Ein Editor, der an das gemeinsame Dokument gebunden ist, löscht darin für alle, was sein Schema nicht kennt (siehe [Schutz vor Datenverlust](#schutz-vor-datenverlust)). Die Apps 2.3.x werden deshalb mit 3.0.0 ausgesperrt. `editorSchema.ts` (`schemaAccepts`) und `vocabularyProblem` (`collab/yJson.ts`) erkennen Inhalte, die diese App-Version nicht kennt (etwa aus einer neueren): Solche Protokolle öffnen nur lesend und werden nie gebunden.
- **Anhänge (Blobs):** Fotos und Dateien stehen nicht im Inhalt eines Protokolls, sondern als Verweis (`blobId`). Sie liegen binär in `blobs` (Server) und `blobs`/`blobData` (App). Die App legt einen neuen Anhang lokal ab (`state: local`), lädt ihn beim Abgleich **vor** den Protokollen hoch (`PUT /api/blobs/:id`, JSON mit Base64) und holt fremde erst beim Anschauen (`GET`, danach als Kopie gemerkt, verdrängt ab 300 MB, nie solche, die nur hier liegen). Der Server gibt einen Anhang dem, der ihn hochgeladen hat, und jedem, der ein sichtbares, nicht gelöschtes Protokoll sieht, das auf ihn verweist (`blob_refs`). Fotos nur als JPEG (Magic-Bytes, 6 MB), Dateien bis 10 MB, nie inline ausgeliefert. Steckt ein Anhang noch im Inhalt (Bestand vor 2.2.0, alte Backups), lagert ihn `migrate.ts` aus (`normalizeContent`, Kennung aus dem Inhalt, gleiche Bytes ergeben einen Blob), beim Start und beim Einspielen eines Backups, mit Backup „vor Update“ und ohne die Änderungszeit anzufassen; die Umstellung auf Yjs (`collab/migrate.ts`) lässt ein Protokoll, in dem noch ein auslagerbarer Anhang steckt, bis dahin aus. Verweist ein soeben gespeicherter Text auf Anhänge, die dem Server fehlen, nennt sie die Antwort des Austauschs (`missingBlobs`), und das Gerät lädt sie erneut hoch, wenn es sie noch hat (Datenbank ersetzt, aufgeräumt). Anhänge ohne Verweis räumt `sweepBlobs` (alle sechs Stunden) in zwei Schritten auf: Der erste Lauf, der keinen Verweis mehr findet, vermerkt `orphanedAt`, erst sieben Tage später fliegt der Blob raus (ein erneuter Verweis oder Upload setzt die Frist zurück). So überlebt ein Foto, auf das ein lange offline gewesenes Gerät noch zeigt.
  - **Warteschlange der App** (`blobSync.ts`): kleinste zuerst; sie blockiert nie die Protokolle. Eine Ablehnung (400/403/409/413/415/422) ist endgültig (`rejected`, Hinweis bleibt), ein Serverfehler oder Zeitlimit pausiert nur diesen Anhang (`failures`, `retryAt`: 1, 2, 4 … 60 Minuten); 401, 429 und fehlendes Netz beenden den Lauf, 404/426 auf `PUT` heißt „Server zu alt“. „Alles neu abgleichen“ setzt Ablehnungen und Pausen zurück (`retryBlobsNow`).
  - **Reservierte Kennungen:** `p-<40 Hex>` und `f-<40 Hex>` vergibt nur der Server beim Auslagern (SHA-256 des Inhalts, `p` Foto, `f` Datei). Ein Upload darf sie tragen, wenn Hash und Art stimmen; sonst 400. Das verhindert, dass jemand einer Auslagerung die Kennung wegnimmt.
  - **Bekannte Grenze:** Der Zugriff folgt den Verweisen. Wer die zufällige Kennung eines fremden Anhangs kennt, kann sie in ein eigenes Protokoll schreiben und sieht ihn dann. Die Kennungen sind nicht erratbar und tauchen nur in Protokollen auf, die man sehen darf; ein Schutz davor, Verweise auf Anhänge zu setzen, die man nicht hochgeladen hat, ist nicht eingebaut.
  - **Keine Seitenaufteilung:** Die Abgleich-Antwort enthält alle Änderungen seit dem Cursor in einem Stück. Dank der ausgelagerten Anhänge ist sie klein; der globale `bodyLimit` des Abgleichs bleibt bei 64 MiB (ein Rest aus der Zeit, in der Apps noch Bilder im Text schickten).
- **Speichern nur bei Änderung:** `autosave.ts` schreibt die Kopfdaten nur, wenn sich etwas geändert hat, und `repo.save` ist ohne Änderung ein No-Op. Der Text wird nur gespeichert, wenn der Editor ihn tatsächlich verändert (die Sitzung schreibt lokale Änderungen des `Y.Doc`, nie das Laden). Öffnen und Zurückgehen erzeugt deshalb weder Revision noch Abgleich.
- **Mitglieder, Dienste, Aufgaben, Kleidung** laufen als allgemeine „Records“ (`records`-Tabelle, JSON je Eintrag): letzte Änderung gewinnt. Lokale Änderungen merkt die **Outbox** vor.
- Jede Änderung bekommt eine globale, steigende Revision. Der Client fragt „alles seit Revision X“.
- Die **Epoche** erkennt eine ausgetauschte Server-Datenbank: Passt sie nicht, lädt der Client alles neu und sendet hoch, was dem Server fehlt. Beim Text heißt das: Der Zustand aller Protokolle, die der Server kennt, wird verworfen (sonst käme beim Zusammenführen zurück, was die Wiederherstellung entfernt hat); hatte ein Protokoll ungesendete Änderungen, entsteht vorher eine Kopie „… (lokale Fassung)“, auch aus dem, was ein offener Editor noch nicht gespeichert hat (`takePending`). Dem Server unbekannte Protokolle behalten ihren Zustand und gehen als neu hoch.
- **Sichtbarkeit:** Jeder Protokoll- und Aufgabeneintrag hat `ownerId` und `shared`. Der Server liefert nur Sichtbares (`shared = 1 OR ownerId = <ich>`). Stellt der Besitzer einen Eintrag wieder privat, merkt sich der Server die Revision (`hiddenRev`) und schickt allen anderen einen **Löschhinweis**, damit ihre lokale Kopie verschwindet. Nie veröffentlichte Einträge erzeugen keinen Hinweis.
- **Abmelden** leert die lokalen Daten (`core/db/wipe.ts`), damit ein Kontowechsel nichts vermischt.

## Gemeinsames Bearbeiten (Yjs)

Seit 3.0.0 ist der **Text** eines Protokolls ein Yjs-Dokument (CRDT), damit mehrere Betreuer gleichzeitig schreiben können, auch mit Geräten ohne Netz. Die Kopfdaten bleiben im normalen [Abgleich](#wie-der-abgleich-funktioniert).

### Aufbau

- **Dokument:** ein `Y.Doc` mit einem `Y.XmlFragment` namens `body`. `@tiptap/y-tiptap` (über `@tiptap/extension-collaboration`) bildet den ProseMirror-Baum darauf ab. Der Editor ist **immer** an ein lokales `Y.Doc` gebunden, auch in der Demo und in der Android-App ohne Server; JSON entsteht nur als Schnappschuss (`protokolle.content`) für Liste, Suche, PDF, ZIP und die Nur-lesen-Ansicht. Rückgängig/Wiederholen kommen aus der Collaboration-Erweiterung (nur eigene Schritte); `undoRedo` und `trailingNode` des StarterKit sind aus.
- **Server** (`server/src/collab/`): schema-frei, er kennt nur `yjs` und einen eigenen Konverter (`convert.ts`: `jsonToYDoc`, `yDocToJson`, `canonicalJson`, mit Grenzen für Tiefe, Knotenzahl und Attributgröße). Ein TipTap-Schema im Server brächte rund zehn Pakete, Versionsdrift zur App und React-Knotenansichten; der Golden-Test hält beide Seiten gleich. Tabelle `ydocs(id, state, sv, updatedAt)` (Zustand und Zustandsvektor), Spalten `protocols.ymode` (1 = umgestellt; 0 = noch nicht, dann nur lesen: `legacy`) und `protocols.metaAt`. Bei jeder wirksamen Änderung leitet der Server `protocols.content` aus dem Zustand ab, erhöht `rev`, setzt `updatedAt` und baut die Anhang-Verweise neu.
- **App** (`app/src/features/protokolle/collab/`): `yStore.ts` (lokaler Zustand in Dexie `ydocs`: Lesen, Mischen, Bestätigen, Verwerfen), `session.ts` (eine `CollabSession` je offenem Editor, ohne Editor testbar), `background.ts` (Austausch für Protokolle ohne offenen Editor, Vorladen), `openPlan.ts` (Entscheidung beim Öffnen), `yJson.ts` (App-Zwilling von `yDocToJson` mit Vokabularprüfung), `base.ts` und `localCopy.ts` (Basis aus altem Inhalt, Kopie „(lokale Fassung)“), `wire.ts` (Transport über HTTP, `NoServer`), `localExtensions.ts` (`LocalTrailingNode`, `localOnly`), `Presence.tsx` (Zeile der Mitschreibenden).

### Austausch

`POST /api/collab/exchange` ist zustandslos: kein Raum im Speicher, keine Verbindung, jede Anfrage steht für sich. Binärdaten gehen als Base64.

- **Anfrage:** `{ epoch, docs: [{ id, sv, update, rev, live, create }] }`. Der Client schickt, was dem Server laut zuletzt bestätigtem Zustandsvektor (`serverSv`) fehlt (`update`, per `encodeStateAsUpdate(doc, serverSv)`), und seinen eigenen Vektor (`sv`). `rev` ist die Revision der letzten angewendeten Antwort: Ist sie unverändert, rechnet der Server nichts. `live` meldet einen offenen Editor, `create` eine Basis, die der Client aus altem Inhalt gebaut hat und die noch nie bestätigt wurde.
- **Antwort:** `{ epoch, docs: [{ id, status, update, sv, rev, peers, missingBlobs, reason }], api }`. Der Server wendet das Update auf den gespeicherten Zustand an, speichert und antwortet mit `diffUpdate(zustand, svDesClients)` und seinem Vektor. Wiederholen ist unschädlich (Yjs wendet dasselbe Update ein zweites Mal ohne Wirkung an): Eine verlorene Antwort braucht keinen Sonderfall.
- **Status je Dokument:**

| Status | Bedeutung | Der Client |
| --- | --- | --- |
| `ok` | angewendet; `update` und `sv` bringen ihn auf den Stand des Servers | übernimmt, bestätigt `serverSv` |
| `gone` | nicht (mehr) sichtbar, gelöscht oder geleert | sichert ungesendeten Text als „(lokale Fassung)“, verwirft den Zustand |
| `legacy` | `ymode = 0`, der Server konnte den Text noch nicht umstellen | nur lesen |
| `exists` | `create`, aber der Server hat schon Text mit anderer Geschichte (keine gemeinsame Client-Kennung) | sichert seine Fassung als Kopie und holt den Zustand des Servers |
| `rejected` | ungültig oder zu groß (`reason`) | merkt es, sendet erst nach einer Änderung wieder |
| `resync` | das Update setzt Unbekanntes voraus | vergisst `serverSv` und schickt beim nächsten Mal den ganzen Zustand |
| `deferred` | über dem Limit der Anfrage oder der Antwort | fragt im nächsten Lauf noch einmal |

- **Falsche Epoche:** HTTP 409 `{ reset: true, epoch }`, nichts wird angewendet; der nächste `/api/sync` räumt auf. Zu niedriges oder fehlendes `X-JFH-Schema`: 426.
- **Grenzen:** Zustand und Update je höchstens 12 MiB (Handschrift-Seiten sind groß), 20 Dokumente je Anfrage, Antwortbudget 8 MiB (das erste Dokument kommt immer vollständig), Body-Limit der Route 24 MiB, Rate-Limit 900/min je Adresse (Demo 3000). Auf den abgeleiteten Inhalt wirken `validateContent` und `MAX_CONTENT` wie beim alten Abgleich.
- **Mitschreibende:** Mit `live` merkt der Server (Dokument, Nutzer) 15 Sekunden **im Speicher** (`peers.ts`, nichts davon in der Datenbank) und liefert in `peers` die Nutzer-IDs ohne den Aufrufer. Die App zeigt die Namen aus dem Verzeichnis (`useDirectory()`); dieselbe Person auf zwei Geräten zählt einmal.

### Sitzung und Zustand auf dem Gerät

- **Dexie v10, Tabelle `ydocs`:** `{ id, update, serverSv, dirty, seq, created, rejected }`. `update` ist der **vollständige** Zustand; Schreiben ist immer Lesen–Mischen–Schreiben (`Y.mergeUpdates`) in einer Transaktion, damit zwei Tabs sich nicht überschreiben. `seq` steigt mit jeder lokalen Änderung: `applyAnswer(id, answer, sentSeq)` löscht `dirty` nur, wenn `seq` noch dem Gesendeten entspricht, so geht nichts verloren, was während des Austauschs getippt wurde. `Protokoll.textRev` ist die Revision, bis zu der der Text bekannt ist (`rev > textRev` heißt: veraltet, im Hintergrund holen). Beim Öffnen wird ein aufgeblähter Zustand über ein `Y.Doc` verdichtet (`compact`) und bei deutlicher Ersparnis zurückgeschrieben.
- **`CollabSession`:** hält das `Y.Doc` und tauscht aus, solange der Editor offen ist (alle 2,5 Sekunden, nach einer Änderung nach 0,8 Sekunden; bei Fehlern mit wachsender Pause bis 30 Sekunden; bei verdecktem Tab Pause, beim Zurückkehren sofort). Lokale Änderungen speichert sie nach 0,5 Sekunden im Dexie, den Schnappschuss (`content`) nach 3 Sekunden und beim Verlassen; „Gespeichert“ folgt `onSaved`. Hat das Protokoll noch keine Revision (`rev = 0`, die Kopfdaten sind nicht beim Server), wartet sie auf den Abgleich der Kopfdaten (`requestSync`). Hält eine Eingabemethode gerade eine Komposition offen (`busy()`), wartet sie mit dem Anwenden fremder Änderungen. Offene Sitzungen sind registriert (`isSessionOpen`); der Hintergrund-Austausch lässt ihre Texte in Ruhe, `syncNow` stößt sie aber an (`exchangeNow`). Ohne Server (Demo im Browser, Android ohne Server) beendet `NoServer` die Sitzung still.
- **Öffnen (`openPlan.ts`):**

| Lage | Verhalten |
| --- | --- |
| lokaler Zustand vorhanden, Vokabularprüfung ok | binden |
| Vokabularprüfung fällt durch | nur lesen (`UnreadableProtokoll`), nie binden |
| kein Zustand, nie gesendet (`rev = 0`), Schnappschuss leer | leeres `Y.Doc`, keine Basis |
| kein Zustand, nie gesendet, Schnappschuss mit Inhalt (aus 2.3.0 oder Demo) | Basis aus dem Schnappschuss mit y-tiptap bauen, `created` setzen (sendet `create`) |
| kein Zustand, dem Server bekannt (`rev > 0`), online | Zustand holen (Austausch mit leerem Vektor), **nie** selbst eine Basis bauen |
| dasselbe, offline | nur lesen mit Hinweis „Zum Bearbeiten muss dieses Protokoll erst mit dem Server abgeglichen werden“ |
| `legacy`, gelöscht, unbekannt | nur lesen bzw. nicht zu öffnen |
| kein Server eingerichtet (Demo, Android ohne Server) | Basis aus dem Schnappschuss, nie gesendet |

- **Abgleich im Hintergrund (`background.ts`):** Nach den Kopfdaten tauscht `syncNow` Texte aus, in der Reihenfolge eigene Änderungen, veraltete Texte (`rev > textRev`), neue Texte (neueste zuerst), je Lauf höchstens 20 Protokolle, nur solche mit `rev > 0`. So bleiben alle sichtbaren Protokolle auch ohne Netz bearbeitbar (wie bis 2.3.0, wo alle Inhalte lokal lagen).

### Schutz vor Datenverlust

Die Fallstricke dieser Bauweise, und was sie auffängt:

- **Unbekanntes Vokabular.** `@tiptap/y-tiptap` löscht im geteilten Dokument jedes Element, das `schema.node(...)` oder `schema.mark(...)` nicht bauen kann (unbekannter Knoten oder Markierung, ungültiges Attribut, verletzter Inhaltsausdruck), und entfernt Y-Attribute, die das Schema des Clients nicht deklariert, und das für alle. `enableContentCheck` prüft nur das schon gebaute Dokument und schützt davor nicht. Deshalb (a) gilt die Versionsregel ([Handshake](#wie-der-abgleich-funktioniert)), (b) prüft die App vor dem Binden und vor jedem Anwenden eines Server-Zustands auf ein offenes Dokument **auf einer Kopie** (`vocabularyProblem`: Knoten, Markierungen, Attributnamen, Inhaltsausdrücke per `Node.check()`); fällt sie durch, öffnet das Protokoll nur lesend und der Editor bindet nie. `golden.test.ts` und `editorSchema.test.ts` sichern das ab.
- **Öffnen schreibt nichts.** Plugins mit `appendTransaction` laufen auch beim ersten Rendern und bei fremden Änderungen: `TrailingNode` hängt einen Absatz an, wenn das Dokument nicht mit einem Absatz endet (etwa nach einem Foto), der Link-`autolink` prüft den ersten Absatz. Beides würde ein Update erzeugen und aus jedem angeschauten Protokoll eine Änderung machen. Darum ist `trailingNode` im StarterKit aus und `LocalTrailingNode` hängt den Absatz nur bei **eigenen** Änderungen an; `localOnly(plugin)` hüllt das `appendTransaction` des Autolinks entsprechend ein (erkennbar an `ySyncPluginKey`); und die Y-Struktur ist kanonisch (Defaults gefüllt, benachbarte Texte in *einem* `Y.XmlText`), weil sonst das erste Editor-Update die Differenz schriebe. Der Golden-Test und der e2e-Test „Öffnen und Zurück verändert auch ein Protokoll mit Foto am Ende und Adresse im Text nicht“ halten das fest.
- **Genau eine Quelle für die Basis.** Zwei Basen mit demselben Inhalt zusammenzuführen verdoppelt ihn. Die Basis eines Bestandsprotokolls baut deshalb der Server (Umstellung beim Start), ein neues Protokoll beginnt mit einem **leeren** `Y.Doc` (y-tiptap legt den ersten Absatz erst beim Tippen an; leere Anfänge verschiedener Geräte lassen sich gefahrlos zusammenführen), und nur ein nie gesendetes Protokoll *mit Inhalt* (aus 2.3.0) bekommt auf dem Gerät eine Basis aus dem Schnappschuss. Sie geht mit `create` hoch; der Server lehnt sie ab (`exists`), wenn er schon Text mit fremder Geschichte hat (zum Beispiel nach einer Wiederherstellung auf einem zweiten Gerät, beide mit `rev = 0`), und das Gerät sichert seine Fassung als Kopie. Wer nur ein JSON-Abbild hat und das Protokoll beim Server weiß, baut **nie** selbst eine Basis, sondern holt den Zustand. `ensureBases` legt die Basen nie gesendeter Protokolle an, **bevor** die Kopfdaten den ersten Abgleich bekommen (danach hätte das Protokoll eine Revision, und das Gerät könnte nicht mehr unterscheiden, ob der Server den Text kennt).
- **Datenbank des Servers ersetzt.** Eine Wiederherstellung darf nicht durch Zusammenführen rückgängig gemacht werden: Bei Epochenwechsel (oder 409) verwirft der Client den Zustand aller Protokolle, die der Server kennt; ungesendeter Text, auch der, den ein offener Editor noch nicht gespeichert hat (`takePending`), wird vorher als „(lokale Fassung)“ gesichert. Die Sitzung endet mit dem Status `replaced`.
- **Gelöscht oder zurückgezogen, während jemand schreibt.** `gone`: Der Editor wird schreibgeschützt, ungesendeter Text bleibt als eigenes privates Protokoll erhalten.
- **Update von 2.3.x.** Das Dexie-Upgrade auf v10 legt für jede Zeile mit ungesendeten Änderungen (`dirty = 1`, `rev > 0`, nicht gelöscht) eine Kopie „(lokale Fassung)“ an (`legacyUnsent.ts`, `preserveUnsent`); das Original gleicht sich mit dem Server ab. Eine Sicherung im Format vor 3.0.0 verhält sich beim Einspielen auf dem Gerät genauso.
- **Server.** Jedes Update läuft durch `validateContent` auf dem abgeleiteten JSON, eigene `SAVEPOINT`s je Dokument, Größen- und Formgrenzen (siehe oben). Ein Update, das Unbekanntes voraussetzt (`pendingStructs`/`pendingDs`), gehört nicht in den Zustand (`resync`).

### Umstellung des Bestands

`migrateYjs` (`server/src/collab/migrate.ts`) läuft beim Start nach der Auslagerung der Anhänge, beim Einspielen eines Backups (auf der Kopie, `restoreFromFile`) und nach dem Befüllen der Demo. Zuerst ein Durchgang ohne Rechnen: Was sich nicht umstellen lässt (Inhalt nicht lesbar, ungültig, Anhänge noch nicht ausgelagert), wird gemeldet. Gibt es etwas zu tun, entsteht ein Backup der Art „update“ (außer im selben Start ist schon eines entstanden). Dann je Protokoll eine Transaktion: `jsonToYDoc`, Gegenprobe (`yDocToJson` des gebauten Zustands muss den kanonischen Inhalt ergeben), `ydocs` und `ymode = 1` schreiben. Inhalt und Änderungszeit bleiben unberührt, die Revision steigt (die Geräte erfahren so von der Umstellung). Ein leerer Inhalt bekommt `ymode = 1` ohne Zustand. Was die Gegenprobe nicht besteht, bleibt `ymode = 0`, wird geloggt und in der Konfiguration (`yMigrationFailed`) vermerkt; die Verwaltung zeigt es auf der Übersicht, die Clients lesen es (`legacy`), PDF, ZIP und Suche gehen weiter, und der nächste Start versucht es erneut. Papierkorb-Einträge werden mitgenommen, geleerte Grabsteine nicht. Der Healthcheck des Images wartet 120 Sekunden, weil der erste Start bei vielen Protokollen dauert.

### Spike-Ergebnisse und Messungen

- **Golden-Roundtrip (S5):** Der Konverter des Servers und y-tiptap bauen und lesen dieselbe Struktur, einschließlich Objektattribut (Handschrift), `blobId`, Tabelle mit Spannen und Markierungen. Fakten, die der Test festhält: y-tiptap speichert `null`-Attribute nicht und schreibt Defaults; benachbarte Texte liegen in *einem* `Y.XmlText`, Markierungen sind Formatattribute; ein leerer Absatz hat kein Textkind.
- **Yjs doppelt geladen (S9):** Server und App haben je eine Kopie von `yjs`. In den Tests, die Server-Code importieren, führt das zur Warnung „Yjs was already imported“ und fehlschlagenden `instanceof`-Prüfungen; `resolve.dedupe: ['yjs']` behebt es. In der Produktion gibt es nur eine Kopie je Paket (die App importiert nie Server-Code).
- **Last (S10),** Node, ein Absatz mit Fett-Text je Eintrag, Zeiten in Millisekunden (einmalig gemessen, kein Benchmark):

| Absätze | JSON | Zustand | Bauen | Kodieren | Laden | → JSON | ein Schreibvorgang gesamt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 23 KB | 18 KB | 8 | 3,5 | 6 | 2 | 11 |
| 1000 | 229 KB | 192 KB | 24 | 13 | 29 | 13 | 45 |
| 10000 | 2290 KB | 1931 KB | 125 | 66 | 243 | 53 | 559 |

  „Ein Schreibvorgang“ ist, was der Server bei einem Austausch mit Änderung tut: Zustand laden, anwenden, neu kodieren, JSON ableiten und schreiben. Ein Protokoll mit tausend Absätzen bleibt bei einem Austausch mit Änderung unter 50 ms. Größer als ein Text wird ein Protokoll vor allem durch Handschrift (große Objektattribute); dafür gelten die Grenzen oben. Auf der App-Seite baut jede fremde Änderung das ganze ProseMirror-Dokument aus dem Y-Baum neu (`_typeChanged`), der Aufwand wächst mit der Dokumentgröße.
- **Bundle (S8):** Die Web-App wächst durch `yjs`, `y-protocols`, `@tiptap/y-tiptap` und `@tiptap/extension-collaboration` um rund 140 kB, komprimiert rund 45 kB (Hauptdatei vorher 323 kB, nachher 369 kB gzip).
- **Laden schreibt nichts (S17):** durch den Golden-Test (`updateYFragment` auf dem geladenen Baum schreibt nichts) und im Browser durch den e2e-Test belegt.
- **Ungeprüft:** Android (CapacitorHttp mit Austausch-Anfragen und -Antworten von mehreren MB, Abgleich im Hintergrund auf einem Gerät) und Safari/iOS (Kontingent von IndexedDB).

### Grenzen

- **Tabellen:** `fixTables` (ProseMirror) läuft auf jedem Gerät für sich; ändern zwei Geräte gleichzeitig die Struktur derselben Tabelle, kann das Zellen doppeln. Text in Zellen läuft normal zusammen.
- **Handschrift:** Das Objektattribut einer Zeichnung wird als Ganzes überschrieben; bei gleichzeitiger Arbeit in *derselben* Zeichnung gewinnt eine Fassung. Große Zustände deckeln die Grenzen oben.
- **Rückgängig** macht nur eigene Schritte rückgängig (y-undo).
- **Wachstum:** Der Text liegt zweimal in der Datenbank (Zustand und JSON), und die Backups wachsen mit. Yjs-Zustände sind verdichtet (`gc`), solange kein Gerät veraltet ist.
- **Kein Paging** der Antwort des Abgleichs (die Kopfdaten sind klein), der Austausch ist über Anfragelimits begrenzt.
- **Noch nicht dabei:** WebSocket und Cursor der anderen (geplant als eigenes Release); der Austausch bleibt HTTP und ist auch dann erstklassig, weil er den Hintergrund-Abgleich ohne offenen Editor trägt und hinter Proxys und in der Android-WebView (`http://`-Server) ohne Sonderfall läuft.

## Der Editor und sein Dokumentformat

Das Dokumentformat bestimmen die Erweiterungen in `app/src/features/protokolle/editorSchema.ts` (`EXTENSIONS`); der Server kennt kein TipTap-Schema und behandelt den Inhalt als JSON. Jede Änderung der Liste (neuer Knoten, neue Markierung, neues Attribut) erhöht `SCHEMA_VERSION` (`schemaVersion.ts`: 1 = 2.0.x, 2 = 2.1.0, 3 = 2.2.x, 4 = 2.3.0, 5 = 3.0.0) **und, seit der Text gemeinsam bearbeitet wird, im selben Release auch `MIN_SERVER_API` (App) sowie `MIN_SCHEMA` und `API_VERSION` (`server/src/versions.ts`)**: Ein Client mit anderem Vokabular löscht im geteilten Dokument, was er nicht kennt, deshalb gibt es keine „sanften“ Erweiterungen mehr, die ältere Apps nur lesen (so war es bei 2.3.0). Der Test „das Dokumentformat entspricht dem Stand von SCHEMA_VERSION“ hält die Liste der Knoten, Markierungen und Attribute fest und schlägt bei jeder Änderung an; ein zweiter koppelt die vier Zahlen. Der Guard `schemaAccepts` erkennt unbekannte **Knoten und Markierungen** und Attributwerte, die ein `validate` ablehnt, die Vokabularprüfung der Sitzung (`vocabularyProblem`) zusätzlich unbekannte **Attributnamen** und verletzte **Inhaltsausdrücke**; Protokolle damit öffnen nur lesend. **Jedes Attribut, das der Editor durchreichen soll, muss im Schema deklariert sein**; sonst entfernt y-tiptap es beim nächsten Schreiben aus dem Dokument (und ProseMirror ignoriert es beim Speichern).

- **Tabellen** (`@tiptap/extension-table`): `table`, `tableRow`, `tableHeader`, `tableCell` mit `colspan`, `rowspan`, `colwidth`, `align`. Zellen nehmen als **direkte Kinder** nur Absätze und Listen auf (`(paragraph | bulletList | orderedList | taskList)+`); tiefer verschachtelt (Liste in einer Zelle, darin ein Listenpunkt mit Tabelle oder Foto) lässt das Schema mehr zu, die Oberfläche legt das nicht an, und das PDF verschachtelt Tabellen in Zellen nicht. Lockern ist später abwärtskompatibel, Verschärfen nicht. `resizable: false` (keine Spaltenbreiten), `cellMinWidth: 96` sorgt dafür, dass viele Spalten im `.tableWrapper` waagerecht scrollen. Die Oberfläche kennt kein Verbinden und Teilen von Zellen; das PDF stellt es dar. In Zellen springt Tab immer zur nächsten Zelle (auch in Listen).
  - **Grenzen:** `colspan` 1 bis 24 (`MAX_TABLE_COLS`), `rowspan` 1 bis 400 (`MAX_TABLE_ROWS`), als `validate` im Schema. TipTap legt für jede Spalte ein `<col>` an: Ein Protokoll mit `colspan: 1000000` legte jeden Editor, der es öffnet, minutenlang lahm; jetzt öffnet es nur lesend. Aus eingefügtem HTML werden die Spannen auf den Bereich gekürzt (`parseHTML`). Die Tabellen-Leiste sperrt „+ Zeile“ und „+ Spalte“ an den Grenzen.
  - **Einfügen von außen:** `pasteTables.ts` (`flattenCellContent`, über `transformPastedHTML`) macht Überschriften, Zitate, Codeblöcke, Trennlinien und verschachtelte Tabellen in `<td>`/`<th>` schon im HTML zu Absätzen; sonst zerreißt der Editor die Tabelle an dieser Stelle (leere Tabelle, die Überschrift außerhalb, der Rest in einer zweiten).
  - **Blöcke aus einer Zelle heraus:** `insertBlocks.ts` (`afterTable`, `insertBlocks`) setzt Foto, Datei, Handschrift und Trennlinie hinter die Tabelle. Der Editor würde sie an der Cursorstelle einfügen und dabei die Tabelle zerteilen. „Einfügen“ blendet in einer Tabelle Tabelle und Zitat aus.
- **Links:** Eine Allowlist für Eingabe, Anzeige, Einfügen, Rendern und PDF (`linkUrl.ts`, `allowedLink`; auf dem Server `safeLink` in `pdf.ts`; der Test `linkParity.test.ts` lässt über mehrere tausend Kombinationen beide gleich entscheiden): nur `http(s)://` mit Host, `mailto:` und `tel:`, ohne Leerzeichen, höchstens 2000 Zeichen. TipTaps Standard erlaubt mehr (`ftp`, `sms`, relative Adressen), deshalb steht `isAllowedUri` auf `allowedLink`; ein Link mit anderem Ziel wird mit leerem `href` ausgegeben. `normalizeUrl` macht aus Eingaben ein Ziel (`beispiel.de` → `https://beispiel.de`, E-Mail → `mailto:`, Nummer ab drei Ziffern → `tel:`; `12` oder `1.2.3` sind weder Nummer noch Adresse). `openOnClick: false` (Tippen setzt den Cursor, geöffnet wird über die Link-Leiste oder Strg+Klick), `inclusive: false` (Weitertippen am Linkende verlängert den Link nicht).
  - **Attribute:** `class`, `target` und `rel` sind deklariert (ältere Apps reichen sie durch), werden aber weder ausgegeben noch aus eingefügtem HTML übernommen; ausgegeben wird immer `target="_blank"` mit `rel="noopener noreferrer nofollow"`. Ein Protokoll mit `class: "photo-lightbox"` konnte sonst die Oberfläche überdecken.
  - **Automatisch:** Tippen oder Einfügen einer Adresse mit Schema (`https://…`, `mailto:`) macht sie zum Link (Autolink und Einfügeregel prüfen `isAllowedUri`, das ein Schema verlangt). Über **markiertem Text** eingefügt, wird der Text zum Link, auch bei „www.beispiel.de“ und bloßen E-Mail-Adressen; dort prüft TipTap nur `shouldAutoLink`, das hier `allowedLink(normalizeUrl(…))` ist.
  - Im PDF steht das Ziel in der Schreibweise der URL-Klasse (`new URL(href).href`): reines ASCII, Umlaute kodiert, internationale Domains als Punycode (eine PDF-Adresse muss 7-Bit-ASCII sein, pdfkit schriebe sonst UTF-16).
- **Hervorhebung:** eine gelbe Markerfarbe, das Attribut `color` ist aber deklariert und wird nur als `#rrggbb` ausgegeben (`hexColor`): Eine spätere Farbauswahl bräuchte so keine Sperre. Die Eingabe- und Einfügeregeln der Erweiterung (`==Text==`) sind abgeschaltet.
- **Werkzeugleiste und Kontextzeile:** `EditorToolbar.tsx` (Werkzeuge), `EditorContext.tsx` (Link-Leiste, wenn der Cursor in einem Link steht, sonst Tabellen-Leiste), `LinkSheet.tsx`, `InsertSheet.tsx` (Tabelle, Zitat, Trennlinie, Handschrift). Die Reihenfolge richtet sich nach dem Handy, wo nur etwa sieben Knöpfe ohne Wischen sichtbar sind (Fett, Kursiv, Listen, Anhang, Einfügen vorn; ein E2E-Test prüft das bei 390 px); Schatten an den Rändern zeigen, dass sich die Leiste weiterwischen lässt. Überschriften sind in Tabellenzellen gesperrt. „Tabelle löschen“ fragt nach, wenn die Tabelle Text enthält. Das „Dock“ (`.ed-dock`) klebt am Rechner oben (Kontextzeile darunter), am Handy unten über der Tastatur (Kontextzeile optisch darüber; im DOM und damit beim Tabben steht sie auch dort hinter der Leiste).
- **PDF** (`server/src/pdf.ts`): Tabellen werden auf ein Raster gelegt (wie in HTML; `colSpan`/`rowSpan` mit leeren Platzhaltern, fehlende Zellen aufgefüllt). Kopfzeilen sind die führenden Zeilen aus `tableHeader`-Zellen (höchstens drei; `headerRows` wiederholt sie auf jeder Seite). Die Spalten haben **feste, gleiche Breiten**, die samt Rändern und Linien auf die Seite passen (`'*'` ließe jede Spalte auf das längste unteilbare Wort wachsen und schöbe die Tabelle bei fünf oder mehr Spalten über den Seitenrand); lange Wörter brechen mitten im Wort um. Grenzen: 400 Zeilen, 24 Spalten, 4000 Zellen, darüber steht ein Hinweis statt der Tabelle; Tabellen in Zellen werden nicht verschachtelt, Seitenumbrüche aus Zellen entfallen. **Kein `dontBreakRows`:** pdfmake lässt damit eine Zeile, die höher ist als eine Seite, komplett weg (mit 300 Absätzen in einer Zelle geprüft). Große Dokumente werden mit Schleifen statt `push(...liste)` zusammengesetzt, sonst sprengt eine Liste mit mehr als etwa 100 000 Einträgen den Stack.
- **Suche:** `extractText` (`search.ts`) macht aus einer Tabellenzeile eine Zeile, Zellen mit „ · “ getrennt.
- **Gemessen** (S8): Die Web-App wird durch die drei Pakete um etwa 58 kB größer (rund 18 kB komprimiert). Ungeprüft: Das Öffnen von Links in der Android-App (`window.open` für `https`, Navigation für `mailto:` und `tel:`, wie bei „Server-Verwaltung öffnen“) auf einem Gerät.

## Web-Push

1. Der Server erzeugt beim ersten Start VAPID-Schlüssel (Tabelle `config`).
2. Die PWA fragt die Erlaubnis ab, abonniert den Browser-Push-Dienst und meldet das Abo am Server an (`/api/push/subscribe`).
3. Die App berechnet die nächsten Erinnerungen **wie für die Android-Alarme** (`planReminders`, `upcomingServices`) und schickt sie an `/api/push/reminders` (je Art vollständig ersetzt).
4. Der Server prüft alle 30 Sekunden, was fällig ist, und verschickt es (`web-push`). Abos, die der Push-Dienst nicht mehr kennt (404/410), werden entfernt. Erinnerungen, die älter als 15 Minuten sind, entfallen.
5. Der Service Worker (`src/sw/sw.template.js`) zeigt die Benachrichtigung; Antippen öffnet die App an der passenden Stelle.

Dass die Termin-Logik im Client bleibt (Ferien, Saison-Zeiten), hält den Server schlank und für Android und Web gleich.

## API in Kürze

Öffentlich: `GET /api/health`, `GET /api/status` (mit `api`, `minSchema`, `features`; im Demo-Modus zusätzlich `demo: { resetAt, accounts }`), `POST /api/setup`, `/api/login`, `/api/invite/accept`.
Angemeldet (Bearer-Token oder Cookie mit `X-JFH: 1`): `/api/me`, `/api/logout`, `/api/account/{password,sessions…}`, `POST /api/sync`, `POST /api/collab/exchange`, `GET /api/protocols/trash`, `POST /api/protocols/:id/restore`, `PUT|GET|HEAD /api/blobs/:id`, `GET /api/protocols/:id/pdf`, `POST /api/clothing/pdf`, `GET /api/export.zip`, `GET /api/holidays`, `/api/push/{key,subscribe,unsubscribe,reminders,test}`.
Nur Admins: `/api/admin/{info,settings,users…,sessions…,protocols…,backup,backups…,restore,preview.pdf}`.

Die Zugriffsregel entscheidet der Server am **Routenmuster** (`req.routeOptions.url`), nie am rohen Pfad, denn Fastify dekodiert Pfade erst beim Routing. Pfade mit unnötig kodierten Zeichen weist ein Hook mit 400 ab, und `security.test.ts` prüft jede neue Route.

## Release

1. Versionen erhöhen: `app/package.json`, `app/android/app/build.gradle` (`versionCode` + `versionName`), `server/package.json`, beide `package-lock.json` (Zeile 3 und 9) und `VERSION` in `server/src/app.ts`; `CHANGELOG.md` ergänzen.
2. Auf `main` mergen, dann den Tag auf dem Merge-Commit setzen: `git tag vX.Y.Z && git push --tags`.
3. GitHub Actions baut das Docker-Image (`ghcr.io/volltext/jf-hub:X.Y.Z`, `:X.Y`, `:latest`) und die APK und legt sie ans Release.

**Releases mit Datenumbau** (zum Beispiel 2.2.0, das Anhänge in eigene Einträge verschiebt, oder 3.0.0, das den Text auf Yjs umstellt): Jeder Push auf `main` baut `:latest`. Teste deshalb zuerst einen **Release-Kandidaten**: Tag `vX.Y.Z-rc.1` auf dem Branch. Er erzeugt das Image `X.Y.Z-rc.1` ohne `:latest` und ohne `:X.Y` und ein Release, das als Vorabversion markiert ist. Starte es mit einer Kopie der echten Datenbank (zweiter Start ändert nichts, Backup „vor Update“ ist da, die Geräte kommen klar), und merge erst dann nach `main`.
