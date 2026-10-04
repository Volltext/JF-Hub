# Änderungen

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/). Versionen folgen [SemVer](https://semver.org/lang/de/).

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
