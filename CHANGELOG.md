# Änderungen

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/). Versionen folgen [SemVer](https://semver.org/lang/de/).

## [Unreleased]

## [2.2.0] – 2026-10-09

Fotos und Dateien liegen nicht mehr im Text der Protokolle, sondern als eigene Anhänge auf dem Server. Protokolle bleiben dadurch klein: Abgleich, Liste, Suche und Konfliktkopien tragen keine Bilder mehr mit.

### Wichtig beim Update

- **Erst den Server aktualisieren, dann die Apps.** Beim ersten Start lagert der Server alle vorhandenen Fotos und Dateien aus den Protokollen aus (bei vielen Fotos dauert das einen Moment). Vorher legt er ein Backup der Art **„vor Update“** an; wenn alles läuft, kannst du es löschen (der Server behält die letzten zwei).
- **Zurück auf 2.1.x geht danach nur mit dem Backup „vor Update“** (Fotos, die seitdem dazugekommen sind, gehen dabei verloren): Ein älterer Server kennt die Anhänge nicht.
- **Apps der Version 2.0.x werden ausgesperrt** und melden „Bitte die App aktualisieren“, bis sie neu installiert sind (die Web-App lädt sich selbst, die Android-App braucht die neue APK). Version 2.1.0 arbeitet weiter, zeigt Fotos aber nur als Hinweis „Bitte die App aktualisieren“. Eine neue App an einem alten Server meldet „Bitte den Server aktualisieren“.

### Neu

- **Anhänge als eigene Einträge:** Die App legt ein Foto oder eine Datei zuerst auf dem Gerät ab und lädt es beim Abgleich **vor** dem Protokoll hoch. Eingefügt ist es sofort zu sehen, auch ohne Netz. Die anderen Betreuer bekommen ein Foto erst, wenn sie es anschauen (und dann bleibt es auf dem Gerät; der Zwischenspeicher fasst 300 MB, die ältesten Kopien weichen zuerst, nie ein Anhang, der nur auf dem Gerät liegt).
- **Dateien bis 10 MB** (vorher 3 MB, und 8 MB je Protokoll insgesamt). Fotos werden wie bisher auf 1600 Pixel verkleinert.
- **Wer ein Foto sieht, bestimmt das Protokoll:** Es ist für den sichtbar, der es hochgeladen hat, und für jeden, der ein sichtbares Protokoll sieht, das darauf verweist. Nimmt der Besitzer ein Protokoll zurück oder löscht es, sehen die anderen auch das Foto nicht mehr.
- **PDF und ZIP-Export** holen die Fotos aus den Anhängen. Fehlt eines, steht an seiner Stelle „Foto nicht verfügbar“, und das PDF entsteht trotzdem. Das ZIP enthält die Fotos und Dateien zusätzlich unter `attachments/`; das JSON verweist mit derselben Kennung darauf.
- **Verwaltung:** Die Übersicht zeigt, wie viele Fotos und Anhänge der Server hält und wie viel Platz sie belegen; die Größe eines Protokolls zählt sie mit.
- **Hinweise bei Problemen:** Lehnt der Server einen Anhang ab (zu groß, kein gültiges JPEG), steht das im Abgleich-Symbol, und der Anhang wird nicht erneut versucht. Ein Serverfehler bei einem einzelnen Anhang hält die Protokolle nicht auf.
- **Sicherung (Version 7) und Abmelden** berücksichtigen Anhänge: Die Sicherung enthält die, die nur auf dem Gerät liegen; die Warnung vor dem Abmelden zählt sie als nicht abgeglichen.

### Geändert

- **Schnittstelle 3, Dokumentformat 3.** Der Server nimmt Apps erst ab dem Dokumentformat 2 an (2.1.0 und neuer).
- Fotos und Dateien aus Apps bis 2.1.x, die noch im Text stecken, lagert der Server beim Speichern selbst aus. Dasselbe Foto in mehreren Protokollen (auch die vielen Konfliktkopien, die frühere Versionen angelegt haben) ergibt einen einzigen Anhang, die Datenbank kann dadurch kleiner werden.
- **Demo:** nur Fotos bis 2 MB, keine Dateianhänge. Das tägliche Zurücksetzen räumt jetzt alle Tabellen ab, auch die hochgeladenen Anhänge der Besucher.
- Anhänge, auf die kein Protokoll mehr verweist, räumt der Server nach sieben Tagen auf; nach dem endgültigen Löschen eines Protokolls sind seine Anhänge also spätestens nach etwa einer Woche weg.
- Wird ein Backup aus einer älteren Version wiederhergestellt, lagert der Server die Anhänge dabei ebenfalls aus.

## [2.1.0] – 2026-10-09

Fundament für die Protokolle: Es geht nichts mehr still verloren, und die App sagt, was passiert ist. Ein Protokoll zu öffnen verändert es nicht mehr, gleichzeitiges Bearbeiten erzeugt eine Kopie statt einer Flut, Gelöschtes lässt sich zurückholen.

### Neu

- **Papierkorb in der App:** Gelöschte Protokolle holst du unter *Protokolle → Papierkorb* zurück (30 Tage, einstellbar). Betreuer sehen ihre eigenen, der Admin zusätzlich die veröffentlichten der anderen. Neu im Server: `GET /api/protocols/trash` und `POST /api/protocols/:id/restore`.
- **Hinweis bei gleichzeitigem Bearbeiten:** Wurde ein Protokoll zur selben Zeit von jemand anderem geändert, steht oben in der Liste die Karte „Gleichzeitig bearbeitet“ mit einem Link zur Kopie „… (Konflikt)“, und die Kopie erklärt sich im Editor selbst. Vorher tauchte sie ohne Erklärung in der Liste auf.
- **Schutz vor unbekannten Inhalten:** Enthält ein Protokoll Elemente, die diese App-Version nicht kennt (zum Beispiel aus einer künftigen Version), wird es nur gelesen und nie überschrieben. Ein Editor würde sie verwerfen, und der Autosave hätte die Fassung auf dem Server damit zerstört.
- **Abgleich meldet Probleme im Klartext:** Fehler wie „Bitte die App aktualisieren“ stehen als Text im Abgleich-Symbol und in der Liste statt nur im Tooltip. Ein Protokoll, das der Server nicht annimmt, bekommt den Chip „abgelehnt“ und blockiert die übrigen nicht mehr.
- **Handshake zwischen App und Server:** Jede Anfrage meldet App-Version und Dokumentformat (`X-JFH-Client`, `X-JFH-Schema`), der Server nennt `api` und `minSchema` (in `/api/status` und in der Abgleich-Antwort). Das legt den Grundstein dafür, zu alte Apps künftig gezielt aufzufordern, sich zu aktualisieren (Antwort 426), statt dass sie etwas beschädigen.

### Behoben

- **Öffnen veränderte Protokolle:** Ein Protokoll nur zu öffnen und zurückzugehen speicherte es neu (neue Revision, „nicht gesendet“, bei zwei Geräten Konflikte). Jetzt wird nur bei einer Änderung gespeichert.
- **Konflikt-Flut:** Ein veralteter Stand legte bei jedem Abgleich eine weitere Kopie „(Konflikt)“ an. Jetzt entsteht je Konflikt eine Kopie (auch wenn eine Antwort verloren geht und der Abgleich wiederholt wird), und liegt der Inhalt auf dem Server schon genau so vor, ist es gar kein Konflikt. Die App übernimmt beim Abgleich nichts über lokal noch nicht gesendete Änderungen hinweg.
- **Ein unbrauchbares Protokoll sperrte den Abgleich** des ganzen Geräts dauerhaft (zum Beispiel ein zu großes oder zu tief verschachteltes Dokument). Der Server nimmt Änderungen jetzt einzeln an und meldet abgelehnte, alle anderen gelten.
- **Gelöscht blieb nicht gelöscht:** Ein Gerät ohne Netz konnte ein gelöschtes Protokoll durch eine Bearbeitung wieder aufleben lassen. Jetzt gewinnt das Löschen durch den Besitzer oder Admin; wegen des Papierkorbs ist es umkehrbar.
- **Endgültig geleerte Protokolle** lassen einen leeren Eintrag (nur Datum und Zeiten, mindestens 90 Tage) stehen. So bringt ein Gerät, das lange kein Netz hatte, sie nicht wieder zurück.
- Protokolle in einem Ordner, den es nicht (mehr) gibt, verschwanden aus der Liste. Sie stehen jetzt oben ohne Ordner.
- Das Editor-Format bewahrt `blobId` und `mime` bei Fotos und Dateien (Vorbereitung auf ausgelagerte Anhänge), und ein Foto ohne Daten zeigt einen Platzhalter statt eines leeren Rahmens.
- Der Editor sagt Bescheid, wenn das Protokoll währenddessen gelöscht oder zurückgezogen wurde, statt weiter zu „speichern“. Das PDF verlangt keine Verbindung mehr, nur weil gerade ein Abgleich lief, der das letzte Speichern noch nicht kannte: Die App gleicht dann noch einmal ab.
- Startseite, Liste und Suche arbeiten bei vielen Protokollen flüssiger: Die Startseite lädt nur die drei jüngsten, der Suchindex entsteht erst bei einem Suchwort.

### Hinweis zum Update

Zuerst den Server aktualisieren, dann die Apps. Die Datenbank wird automatisch angepasst (zusätzliche Spalten, nichts geht verloren). Apps der Version 2.0.x arbeiten weiter mit dem neuen Server; Papierkorb, Hinweise und Schutz vor unbekannten Inhalten bringt erst die App 2.1.0 mit. Für die Entwicklung gilt jetzt Node ≥ 22.13, weil die App-Tests den Abgleich des Servers (`node:sqlite`) mitlaufen lassen.

## [2.0.4] – 2026-10-09

Sicherheits-Update. **Bitte sofort aktualisieren** (betroffen: 2.0.0 bis 2.0.3). Eine ausführliche Beschreibung folgt im GitHub-Security-Advisory.

### Sicherheit

- **Die Zugriffsprüfung des Servers wurde verschärft.** Sie richtet sich jetzt nach der Route, die der Server tatsächlich ausführt, und nicht mehr nach der Schreibweise der Adresse; ungewöhnlich kodierte Adressen werden abgewiesen. Ein Test geht alle Routen durch, auch in abweichender Schreibweise.
- **Wer den Server aus dem Internet erreichbar betrieben hat**, sollte vorsorglich davon ausgehen, dass Daten eingesehen worden sein können, die Passwörter neu vergeben (der Admin erzeugt unter *Benutzer* neue Links; beim Ändern des Passworts werden die anderen Geräte abgemeldet) und, falls vorhanden, das Zugriffs-Log auf ungewöhnliche Anfragen an die Verwaltung durchsehen.
- Anfragen ohne Anmeldung werden abgewiesen, **bevor** der Body gelesen wird.
- API-Antworten (Export, PDF, Backup) tragen `Cache-Control: no-store` und landen nicht in Zwischenspeichern, auch nicht in denen eines CDN.

### Behoben

- **PDF und ZIP-Export:** Ein Protokoll mit unbrauchbarem Inhalt konnte das PDF oder den ganzen Export für alle verhindern. Jetzt entfällt nur das PDF dieses Protokolls: Das ZIP enthält eine Datei `export-fehler.txt`, der Rohinhalt liegt unter `json/`.
- Das PDF eines gelöschten Protokolls (Papierkorb) ließ sich weiter abrufen.
- ZIP-Export: Ordnernamen werden bereinigt.

### Neu

- **Demo im Browser** (`npm run build:demo`, auf der Website unter `/demo/`): die App ohne Server und ohne Anmeldung, mit denselben Beispieldaten wie der Demo-Modus des Servers. Alles bleibt im Browser des Besuchers, „Zurücksetzen“ legt die Daten neu an; PDF und Benachrichtigungen erklären, dass sie den Server brauchen. Die Beispieldaten liegen dafür in `server/src/demoData.ts` (eine Quelle für beide Demos).

## [2.0.3] – 2026-10-06

### Behoben

- **APK-Build** (Workflow `android.yml`) brach ab, weil Dependabot den Gradle-Wrapper auf 9.8.0 gehoben hatte; das von Capacitor 8 vorgegebene Android Gradle Plugin 8.13 läuft nur bis Gradle 9.5. Der Wrapper steht wieder auf 8.14.3, und Dependabot schlägt keine Major-Sprünge für Gradle und das Android Gradle Plugin mehr vor.

## [2.0.2] – 2026-10-06

### Geändert

- **Dokumentation neu gestaltet:** README mit Titelbild, Screenshots, 3-Schritte-Start und Wegweiser. Alle Anleitungen in `docs/` einheitlich gegliedert, mit Inhaltsverzeichnis, Hinweisen und einklappbaren Details.

### Neu

- **Demo-Modus** (`DEMO=1`, Anleitung in `docs/demo.md`): Der Server legt erfundene Beispieldaten der „Jugendfeuerwehr Musterstadt“ an (Mitglieder, Dienste, Aufgaben, Kleidung, Protokolle, Wettkampf-Läufe) und setzt sie täglich um `DEMO_RESET_AT` (Standard 03:00) zurück. App und Verwaltung bieten die Demo-Zugänge als Knopf an und zeigen einen Hinweis. Was alle Besucher aussperren würde (Passwörter, Backups, Demo-Konten ändern), ist gesperrt.
- **Projekt-Website** in `website/`, veröffentlicht per GitHub Pages (Workflow `pages.yml`); die Demo-Knöpfe führen zur Demo im Browser oder, mit der Repository-Variable `DEMO_URL`, zu einem Demo-Server.
- **Anleitung „Erste Schritte“** (`docs/erste-schritte.md`): vom Admin-Konto bis zum ersten Dienst, mit Screenshots.
- **Übersichtsseite** `docs/README.md` mit Wegweiser nach Thema.

## [2.0.1] – 2026-10-06

Stabilisierung nach der ersten öffentlichen Version.

### Neu

- **Automatische Backups:** Der Server sichert täglich in `/data/backups` (Standard: die letzten 7, einstellbar). In der Admin-Oberfläche lassen sich Backups anlegen, herunterladen, löschen und **wiederherstellen**, auch aus einer hochgeladenen Datei und aus Sicherungen älterer Versionen. Vor jeder Wiederherstellung sichert der Server den aktuellen Stand; alle Geräte gleichen sich danach neu ab.
- **Wettkampf-Läufe und Aufstellungs-Vorlagen** werden mit dem Server abgeglichen (für alle Betreuer sichtbar). Bestehende Läufe werden beim ersten Abgleich nach dem Update hochgeladen. Beim Abmelden werden sie, wie die übrigen abgeglichenen Daten, vom Gerät entfernt und kommen bei der Anmeldung zurück.
- **Rauchtest im Browser** (Playwright) in der CI: Anmeldung, Protokoll schreiben, veröffentlichen und zurücknehmen, Backup und Wiederherstellung.

### Behoben

- Repo-Adressen in README, Installationsanleitung, Compose-Datei und Issue-Vorlagen zeigten auf ein anderes Repository; das Standard-Image heißt jetzt `ghcr.io/volltext/jf-hub`.
- Node-Version vereinheitlicht: Docker-Image, CI und Doku nutzen Node 22 (das Image baute zuvor mit Node 26). Dependabot schlägt keine Node-Major-Sprünge mehr vor.
- Der Knopf „Alle Protokolle als ZIP“ in der Admin-Oberfläche rief eine nicht vorhandene Adresse auf.

### Hinweis zum Update

Wer 2.0.0 mit dem Image `ghcr.io/amgiparker/open-jf-hub` betreibt, stellt `JF_HUB_IMAGE` auf `ghcr.io/volltext/jf-hub:latest` um. Die Datenbank wird automatisch angepasst; Wettkampf-Läufe, die bisher nur auf einem Gerät lagen, kommen beim ersten Abgleich auf den Server. Mit dem Update der App-Geräte (PWA lädt sich selbst, APK neu installieren) erscheinen sie auch auf den anderen.

## [2.0.0] – 2026-10-04

Erste öffentliche Version (Neustart der Zählung gegenüber den privaten Vorgängern 1.x).

### Neu

- **Mehrere Betreuer:** Benutzerverwaltung mit Rollen (Admin/Betreuer), Einladungslinks (jede Person vergibt ihr Passwort selbst), Sperren, Löschen, Geräte-Verwaltung.
- **Privat oder veröffentlicht:** Protokolle und Aufgaben gehören dem Ersteller und sind zuerst privat; „Veröffentlichen“ macht sie für alle Betreuer sichtbar und bearbeitbar. Zurücknehmen entfernt sie bei den anderen.
- **PWA:** Die komplette App läuft im Browser, ist installierbar und offline nutzbar (Service Worker).
- **Web-Push:** Erinnerungen für Dienst und Aufgaben als Benachrichtigung in der PWA – vom Server verschickt, auch bei geschlossener Seite. Mit Testbenachrichtigung.
- **Ein Docker-Image** für Server, Web-App und Admin-Oberfläche (`amd64` und `arm64`), Compose-Datei mit Cloudflare-Tunnel-Profil und Caddy-Variante.
- Schulferien für die Dienst-Erinnerung kommen über den Server (kein Zugriff der Browser auf Fremdserver nötig).
- Beim Abmelden werden die lokalen Daten entfernt (sicher auf geteilten Geräten, kein Vermischen beim Kontowechsel).

### Geändert

- Der „Protokoll-Server“ heißt jetzt einfach **Server**; er enthält Benutzerverwaltung, Abgleich, PDF-Erzeugung und Admin-Oberfläche.
- Anmeldung mit Benutzername und Passwort statt eines gemeinsamen Passworts. Im Browser liegt die Sitzung in einem `HttpOnly`-Cookie.
- `TRUST_PROXY` ist einstellbar (Standard: nur Proxys aus privaten Netzen), die Anmelde-Begrenzung gilt je Adresse **und** je Konto.
- Der Docker-Port ist standardmäßig nur lokal (`127.0.0.1`) erreichbar.

### Entfernt

- Anbindung an externe Dienstbuch-Automatisierung, Import aus den alten privaten Apps, App-Update über den Server (APKs kommen über GitHub-Releases).

### Update von der privaten Vorversion

Ein bestehender Server (1.x) wird beim Start automatisch migriert: Das bisherige Passwort wird das Admin-Konto `admin`, vorhandene Protokolle bleiben für alle sichtbar, Aufgaben werden privat beim Admin. Details: [Umstieg](docs/umstieg-von-1x.md).
