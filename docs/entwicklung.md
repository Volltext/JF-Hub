# Entwicklung

[← Dokumentation](README.md)

Für alle, die an JF Hub mitarbeiten. Wie du Fehler meldest und Code beiträgst, steht in [CONTRIBUTING.md](../CONTRIBUTING.md).

**Auf dieser Seite:** [Voraussetzungen](#voraussetzungen) · [Starten](#starten) · [Tests und Prüfungen](#tests-und-prüfungen) · [Aufbau](#aufbau) · [Abgleich](#wie-der-abgleich-funktioniert) · [Web-Push](#web-push) · [API](#api-in-kürze) · [Release](#release)

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

Dazu kommt ein **Rauchtest im Browser** (Playwright, Ordner `e2e/`): Er startet den echten Server mit der gebauten Web-App, meldet zwei Betreuer an, schreibt ein Protokoll, veröffentlicht es und nimmt es wieder zurück. Ein zweiter Server läuft im [Demo-Modus](demo.md) und prüft die Anmeldung per Knopf und die Beispieldaten; die [Demo im Browser](demo.md#demo-im-browser) wird wie auf GitHub Pages unter einem Unterpfad ausgeliefert und geprüft. Ein dritter Server (Port 8096, eigene Daten) gehört `e2e/tests/protokolle.spec.ts`: Öffnen verändert nichts, Papierkorb, gleichzeitiges Bearbeiten mit einem Gerät ohne Netz, Schutz vor unbekannten Editor-Inhalten und der Zugriffsschutz der Routen. Er ist getrennt, weil die Anmeldung je Adresse begrenzt ist (8 je 15 Minuten) und der Rauchtest sie sonst aufbraucht.

```bash
cd server && npm run build && cd ../app && npm run build:web && npm run build:demo     # Voraussetzung: Server, Web-App und Demo gebaut
cd ../e2e && npm ci && npx playwright install chromium && npm test
# Mit vorhandenem Chromium: PW_CHROMIUM_PATH=/pfad/zu/chrome npm test
```

Die CI (`.github/workflows/ci.yml`) führt alles aus, baut die PWA und startet das Docker-Image als Rauchtest.

Was getestet wird: Wertungslogik und Regeln (reine Funktionen), Datenbank-Schema, Abgleich (Konflikte, Sichtbarkeit, Löschhinweise), Dienst-Rhythmus, Web-Push-Client, Service Worker (in einer nachgebauten Umgebung), Server-API (Anmeldung, Benutzer, Sichtbarkeit, Push, PDF, Migration einer Alt-Datenbank), Anhänge (Hochladen und Zugriff, Auslagern aus dem Inhalt, Migration, Müllsammlung, PDF und ZIP mit Fotos), Editor-Schema und Link-Regeln, PDF mit Tabellen, Links und feindlichen Eingaben.

Zwei Tests haben eine besondere Rolle:

- **`server/src/security.test.ts`** sammelt über einen `onRoute`-Hook alle Routen des Servers und prüft für jede nicht öffentliche, dass sie ohne Anmeldung 401 liefert (`/api/admin/*` für Betreuer 403), auch bei abweichender Schreibweise des Pfads. Eine neue Route ist damit automatisch abgedeckt; sie muss nur ein Muster haben, das zur Zugriffsregel passt.
- **`app/src/features/protokolle/twoClients.test.ts`** lässt zwei Geräte (zwei Dexie-Datenbanken) gegen das **echte** `applySync` des Servers laufen, Anhänge eingeschlossen (`checkUpload`, `findBlob`: dieselben Regeln für Prüfung und Zugriff wie im Server). Die App-Tests importieren dafür Code aus `server/src`; das Docker-Image ist davon nicht betroffen (die Web-App baut Vite, `*.test.ts` liegt in `.dockerignore`).

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
    sync.ts       Abgleich mit Besitz und Sichtbarkeit
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
- **Protokolle** haben eine Server-Revision (`rev`). Eine Änderung gilt, wenn sie auf der aktuellen Revision aufbaut oder dem Server schon genau so vorliegt. Sonst bleibt die Server-Fassung und die Client-Fassung wird als „(Konflikt)“-Kopie gesichert. Die Kopie hat eine feste Kennung aus Nutzer, Dokument und veralteter Basis: Wer auf dem alten Stand weitertippt oder eine verlorene Antwort wiederholt, schreibt dieselbe Kopie fort. Die Antwort nennt die Konflikte (`conflicts`), die App zeigt sie als Karte (`conflicts.ts`, gemerkt in `kv 'protokolle.conflicts'`).
- **Löschen gewinnt:** Löscht der Besitzer oder der Admin ein Protokoll, setzt sich das auch gegen eine Bearbeitung auf veralteter Basis durch. Gelöschte Protokolle liegen `trashDays` im Papierkorb (`GET /api/protocols/trash`, `POST /api/protocols/:id/restore`); danach leert `purgeProtocol` den Inhalt und lässt einen Grabstein (`purgedAt`, neue Revision) stehen, den `sweepTrash` erst nach `max(tokenDays, 90)` Tagen entfernt. So lässt ein Gerät, das lange kein Netz hatte, nichts wiederauferstehen.
- **Fehlerisolation:** Jede Änderung läuft in einem `SAVEPOINT`. Was der Server nicht annehmen kann (zu groß, zu tief verschachtelt, kein gültiges Dokument), steht in `rejected` der Antwort; alles andere gilt. Der Client markiert das Protokoll (`rejected`, Chip „abgelehnt“) und schickt es erst wieder, wenn es geändert wurde.
- **Übernehmen:** Der Client überspringt Dokumente mit lokal noch nicht gesendeten Änderungen und hält den Cursor davor an (`min(res.rev, kleinste übersprungene Revision − 1)`). Beim nächsten Lauf kommt die Server-Fassung erneut; das ist idempotent.
- **Handshake:** Jede Anfrage trägt `X-JFH-Client` (App-Version) und `X-JFH-Schema` (Stand des Dokumentformats, `features/protokolle/schemaVersion.ts`). Der Server nennt in `/api/status` und in der Abgleich-Antwort `api` und `minSchema` und weist Apps unterhalb von `MIN_SCHEMA` mit 426 („Bitte die App aktualisieren“) ab; die App prüft umgekehrt `api >= MIN_SERVER_API`. Kommen im Editor neue Knoten oder Markierungen dazu, steigt `SCHEMA_VERSION`. `editorSchema.ts` (`schemaAccepts`) erkennt Inhalte, die diese App-Version nicht kennt (etwa aus einer neueren): Solche Protokolle öffnen nur lesend, denn ein Editor würde die unbekannten Teile verwerfen und der Autosave damit die Server-Fassung überschreiben.
- **Anhänge (Blobs):** Fotos und Dateien stehen nicht im Inhalt eines Protokolls, sondern als Verweis (`blobId`). Sie liegen binär in `blobs` (Server) und `blobs`/`blobData` (App). Die App legt einen neuen Anhang lokal ab (`state: local`), lädt ihn beim Abgleich **vor** den Protokollen hoch (`PUT /api/blobs/:id`, JSON mit Base64) und holt fremde erst beim Anschauen (`GET`, danach als Kopie gemerkt, verdrängt ab 300 MB, nie solche, die nur hier liegen). Der Server gibt einen Anhang dem, der ihn hochgeladen hat, und jedem, der ein sichtbares, nicht gelöschtes Protokoll sieht, das auf ihn verweist (`blob_refs`). Fotos nur als JPEG (Magic-Bytes, 6 MB), Dateien bis 10 MB, nie inline ausgeliefert. Steckt ein Anhang noch im Inhalt (Apps bis 2.1.x, alte Backups), lagert der Server ihn beim Speichern aus (`normalizeContent`, Kennung aus dem Inhalt, gleiche Bytes ergeben einen Blob); `migrate.ts` erledigt das für den Bestand, mit Backup „vor Update“ und ohne die Änderungszeit anzufassen. `migratedFrom` sorgt dafür, dass eine Bearbeitung auf dem Stand vor der Migration kein Konflikt wird. Verweist ein soeben gespeichertes Protokoll auf Anhänge, die dem Server fehlen, nennt ihn die Antwort (`missingBlobs`), und das Gerät lädt sie erneut hoch, wenn es sie noch hat (Datenbank ersetzt, aufgeräumt). Anhänge ohne Verweis räumt `sweepBlobs` (alle sechs Stunden) in zwei Schritten auf: Der erste Lauf, der keinen Verweis mehr findet, vermerkt `orphanedAt`, erst sieben Tage später fliegt der Blob raus (ein erneuter Verweis oder Upload setzt die Frist zurück). So überlebt ein Foto, auf das ein lange offline gewesenes Gerät noch zeigt.
  - **Warteschlange der App** (`blobSync.ts`): kleinste zuerst; sie blockiert nie die Protokolle. Eine Ablehnung (400/403/409/413/415/422) ist endgültig (`rejected`, Hinweis bleibt), ein Serverfehler oder Zeitlimit pausiert nur diesen Anhang (`failures`, `retryAt`: 1, 2, 4 … 60 Minuten); 401, 429 und fehlendes Netz beenden den Lauf, 404/426 auf `PUT` heißt „Server zu alt“. „Alles neu abgleichen“ setzt Ablehnungen und Pausen zurück (`retryBlobsNow`).
  - **Reservierte Kennungen:** `p-<40 Hex>` und `f-<40 Hex>` vergibt nur der Server beim Auslagern (SHA-256 des Inhalts, `p` Foto, `f` Datei). Ein Upload darf sie tragen, wenn Hash und Art stimmen; sonst 400. Das verhindert, dass jemand einer Auslagerung die Kennung wegnimmt.
  - **Bekannte Grenze:** Der Zugriff folgt den Verweisen. Wer die zufällige Kennung eines fremden Anhangs kennt, kann sie in ein eigenes Protokoll schreiben und sieht ihn dann. Die Kennungen sind nicht erratbar und tauchen nur in Protokollen auf, die man sehen darf; ein Schutz davor, Verweise auf Anhänge zu setzen, die man nicht hochgeladen hat, ist nicht eingebaut.
  - **Keine Seitenaufteilung:** Die Abgleich-Antwort enthält alle Änderungen seit dem Cursor in einem Stück. Dank der ausgelagerten Anhänge ist sie klein; der globale `bodyLimit` des Abgleichs bleibt bei 64 MiB, damit Apps der Version 2.1.x, die noch Bilder im Text schicken, durchkommen.
- **Speichern nur bei Änderung:** `autosave.ts` schreibt nur, wenn sich etwas geändert hat, und `repo.save` ist ohne Änderung ein No-Op. Öffnen und Zurückgehen erzeugt deshalb weder Revision noch Abgleich.
- **Mitglieder, Dienste, Aufgaben, Kleidung** laufen als allgemeine „Records“ (`records`-Tabelle, JSON je Eintrag): letzte Änderung gewinnt. Lokale Änderungen merkt die **Outbox** vor.
- Jede Änderung bekommt eine globale, steigende Revision. Der Client fragt „alles seit Revision X“.
- Die **Epoche** erkennt eine ausgetauschte Server-Datenbank: Passt sie nicht, lädt der Client alles neu und sendet hoch, was dem Server fehlt.
- **Sichtbarkeit:** Jeder Protokoll- und Aufgabeneintrag hat `ownerId` und `shared`. Der Server liefert nur Sichtbares (`shared = 1 OR ownerId = <ich>`). Stellt der Besitzer einen Eintrag wieder privat, merkt sich der Server die Revision (`hiddenRev`) und schickt allen anderen einen **Löschhinweis**, damit ihre lokale Kopie verschwindet. Nie veröffentlichte Einträge erzeugen keinen Hinweis.
- **Abmelden** leert die lokalen Daten (`core/db/wipe.ts`), damit ein Kontowechsel nichts vermischt.

## Der Editor und sein Dokumentformat

Das Dokumentformat bestimmen die Erweiterungen in `app/src/features/protokolle/editorSchema.ts` (`EXTENSIONS`); der Server kennt kein TipTap-Schema und behandelt den Inhalt als JSON. Jede Änderung der Liste (neuer Knoten, neue Markierung, neues Attribut) erhöht `SCHEMA_VERSION` (`schemaVersion.ts`: 1 = 2.0.x, 2 = 2.1.0, 3 = 2.2.x, 4 = 2.3.0); der Test „das Dokumentformat entspricht dem Stand von SCHEMA_VERSION“ hält die Liste der Knoten, Markierungen und Attribute fest und schlägt bei jeder Änderung an. Ältere Apps schützt der Guard `schemaAccepts`: Er erkennt unbekannte **Knoten und Markierungen** und Attributwerte, die ein `validate` ablehnt (nicht aber Inhaltsausdrücke), und lässt solche Protokolle nur lesen. Neue Elemente brauchen deshalb keine Sperre (`MIN_SCHEMA`), aber **jedes Attribut, das ältere Apps durchreichen sollen, muss im Schema deklariert sein**; sonst fallen sie beim Speichern still weg (ProseMirror ignoriert unbekannte Attribute).

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
Angemeldet (Bearer-Token oder Cookie mit `X-JFH: 1`): `/api/me`, `/api/logout`, `/api/account/{password,sessions…}`, `POST /api/sync`, `GET /api/protocols/trash`, `POST /api/protocols/:id/restore`, `PUT|GET|HEAD /api/blobs/:id`, `GET /api/protocols/:id/pdf`, `POST /api/clothing/pdf`, `GET /api/export.zip`, `GET /api/holidays`, `/api/push/{key,subscribe,unsubscribe,reminders,test}`.
Nur Admins: `/api/admin/{info,settings,users…,sessions…,protocols…,backup,backups…,restore,preview.pdf}`.

Die Zugriffsregel entscheidet der Server am **Routenmuster** (`req.routeOptions.url`), nie am rohen Pfad, denn Fastify dekodiert Pfade erst beim Routing. Pfade mit unnötig kodierten Zeichen weist ein Hook mit 400 ab, und `security.test.ts` prüft jede neue Route.

## Release

1. Versionen erhöhen: `app/package.json`, `app/android/app/build.gradle` (`versionCode` + `versionName`), `server/package.json`, beide `package-lock.json` (Zeile 3 und 9) und `VERSION` in `server/src/app.ts`; `CHANGELOG.md` ergänzen.
2. Auf `main` mergen, dann den Tag auf dem Merge-Commit setzen: `git tag vX.Y.Z && git push --tags`.
3. GitHub Actions baut das Docker-Image (`ghcr.io/volltext/jf-hub:X.Y.Z`, `:X.Y`, `:latest`) und die APK und legt sie ans Release.

**Releases mit Datenumbau** (zum Beispiel 2.2.0, das Anhänge in eigene Einträge verschiebt): Jeder Push auf `main` baut `:latest`. Teste deshalb zuerst einen **Release-Kandidaten**: Tag `vX.Y.Z-rc.1` auf dem Branch. Er erzeugt das Image `X.Y.Z-rc.1` ohne `:latest` und ohne `:X.Y` und ein Release, das als Vorabversion markiert ist. Starte es mit einer Kopie der echten Datenbank (zweiter Start ändert nichts, Backup „vor Update“ ist da, die Geräte kommen klar), und merge erst dann nach `main`.
