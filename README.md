# JF Hub

**Die selbst gehostete Zentrale für die Jugendfeuerwehr-Betreuer:** Protokolle, Dienste und Anwesenheit, Aufgaben, Kleidergrößen und Wettkampf-Training – auf Handy, Tablet und Laptop, auch ohne Netz.

[![Lizenz: AGPL-3.0](https://img.shields.io/badge/Lizenz-AGPL--3.0-c0392b)](LICENSE)
[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
`Docker` · `PWA` · `Android` · `Open Source`

> Inoffizielles Projekt aus der Jugendfeuerwehr-Praxis. Es ist kein Produkt der Deutschen Jugendfeuerwehr. Regeln und Wertungen sind eine Hilfe ohne Gewähr (siehe [NOTICE](NOTICE.md)).

## Was kann JF Hub?

| Bereich | Das gibt es |
| --- | --- |
| **Protokolle** | Texteditor mit Überschriften, Listen und Checklisten, **Fotos** und Dateianhängen, **Handschrift** mit dem Stift (Android-App mit Stiftdruck und Texterkennung, im Browser ein einfacher Editor), Ordner, Volltextsuche, **PDF** im eigenen Layout (Logo, Fußzeile, Farbe) |
| **Dienste** | Anwesenheit erfassen, Statistik, wöchentliche **Erinnerung** (mit Ferien-Rhythmus je Bundesland) |
| **Aufgaben** | Eigene Aufgaben oder für alle Betreuer **veröffentlichen**, Fälligkeit, Erinnerung |
| **Mitglieder & Kleidung** | Mitgliederliste, Kleidergrößen, „eine Größe größer“ vormerken, PDF für den Kleiderwart |
| **Wettkampf** | Bundeswettbewerb und Leistungsspange: Aufstellung, Stoppuhr, Fehlerwertung, Analyse, Wissensdatenbank |
| **Mehrere Betreuer** | Eigenes Konto je Person (Admin lädt ein), Rollen, Protokolle und Aufgaben **privat oder veröffentlicht** |
| **Überall nutzbar** | Als **PWA** im Browser und auf dem Startbildschirm (iPhone, Android, Windows, Mac, Linux), optional als **Android-App** |
| **Offline** | Alles ist lokal gespeichert und wird abgeglichen, sobald wieder Netz da ist |
| **Benachrichtigungen** | Web-Push in der PWA, lokale Alarme in der Android-App |

Die Daten liegen auf **deinem** Server, nicht bei einem Anbieter.

## Schnellstart

Du brauchst einen Rechner mit [Docker](https://docs.docker.com/get-docker/) (Docker Compose v2.24 oder neuer) – ein Raspberry Pi, ein NAS, ein Heimserver oder ein kleiner Cloud-Server reichen.

```bash
git clone https://github.com/Volltext/JF-Hub.git
cd JF-Hub
cp .env.example .env
docker compose up -d
docker compose logs jf-hub | grep -A2 Ersteinrichtung
```

1. Öffne `http://localhost:8080/admin/`, gib den **Setup-Code** aus dem Log ein und lege das erste Admin-Konto an.
2. Unter **Benutzer** lädst du die anderen Betreuer ein. Jeder bekommt einen Link und vergibt sein Passwort selbst.
3. Die App für alle Betreuer liegt unter `http://localhost:8080/`.

Ohne `git`: Das fertige Image und eine Beispiel-Compose-Datei stehen in der [Installationsanleitung](docs/installation.md).

## Von außen erreichbar machen (HTTPS)

Damit die Betreuer von unterwegs zugreifen können – und damit **Installation als App und Benachrichtigungen** funktionieren – braucht der Server eine verschlüsselte Adresse (https).

**Empfohlen: Cloudflare Tunnel** – kostenlos, ohne Port-Freigabe am Router, ohne Zertifikate:

```bash
# TUNNEL_TOKEN in .env eintragen (Anleitung: docs/cloudflare-tunnel.md), dann:
docker compose --profile tunnel up -d
```

Du hast schon einen Reverse-Proxy, eine eigene Domain oder Tailscale? Kein Problem: [HTTPS-Alternativen](docs/https-alternativen.md) (Caddy mit automatischem Zertifikat ist eine Zeile).

## Als App installieren

- **PWA (empfohlen):** Adresse im Browser öffnen, anmelden, dann „Zum Startbildschirm hinzufügen“ bzw. „App installieren“. Auf dem iPhone/iPad ist das für Benachrichtigungen Pflicht.
- **Android-App (optional):** APK aus den [Releases](../../releases) laden. Vorteile: Handschrift-Editor mit Stiftdruck und Texterkennung, zuverlässige Erinnerungen als Alarm. Details: [Android-App](docs/android-app.md).

## Konten und Sichtbarkeit

- Der **Admin** legt Betreuer an, sperrt Konten, setzt Passwörter zurück (neuer Einladungslink) und passt das PDF-Layout an.
- **Mitglieder, Dienste und Kleidung** gehören der ganzen Gruppe.
- **Protokolle und Aufgaben** sind zuerst **privat** (nur du). Mit „Veröffentlichen“ sehen sie alle Betreuer und können sie bearbeiten bzw. abhaken. Zurücknehmen und Löschen kann nur der Besitzer (und der Admin).
- Beim Abmelden werden die Daten vom Gerät entfernt – sicher auch auf geteilten Tablets.

Mehr dazu: [Benutzer und Sichtbarkeit](docs/benutzer-und-sichtbarkeit.md).

## Konfiguration

Alles ist optional, Standardwerte funktionieren. Die Werte stehen in `.env` (Vorlage: [.env.example](.env.example)):

| Variable | Bedeutung | Standard |
| --- | --- | --- |
| `BIND`, `HOST_PORT` | Auf welcher Adresse/welchem Port der Server im Netz lauscht | `127.0.0.1`, `8080` |
| `DATA_PATH` | Ordner oder Volume für die Datenbank | Volume `jf-hub-data` |
| `ADMIN_USER`, `ADMIN_PASSWORD` | Admin-Konto beim ersten Start anlegen (statt Setup-Code) | leer |
| `PUSH_SUBJECT` | Kontaktadresse für den Push-Dienst (`mailto:…`) – bitte eigene eintragen | `mailto:admin@example.com` |
| `TRUST_PROXY` | Welchen Proxys `X-Forwarded-For` geglaubt wird | private Netze |
| `TUNNEL_TOKEN` | Token für Cloudflare Tunnel (Profil `tunnel`) | leer |
| `TZ` | Zeitzone | `Europe/Berlin` |

## Aktualisieren und sichern

```bash
docker compose pull && docker compose up -d     # neue Version (Image von GitHub)
docker compose up -d --build                    # neue Version (aus den Quellen gebaut)
```

Die Datenbank ist **eine Datei** (`jf-hub.sqlite` im Volume `/data`). Sichern: das Volume kopieren oder in der Admin-Oberfläche unter **Backup & Export** ein Backup laden. Die Daten-Migrationen laufen beim Start von selbst.

## Sicherheit und Datenschutz

- Passwörter werden mit scrypt gespeichert, Anmeldungen sind einzeln widerrufbar, Login-Versuche sind begrenzt, der Container läuft ohne Root-Rechte.
- JF Hub speichert bewusst wenig: Namen der Mitglieder, Anwesenheit, Kleidergrößen – **keine** Geburtsdaten, Adressen oder Kontaktdaten.
- Es sind Daten von Kindern und Jugendlichen. Lies bitte [Datenschutz](docs/datenschutz.md) und klär das Hosting mit deiner Wehr bzw. deinem Träger.
- Sicherheitslücken bitte vertraulich melden: [SECURITY.md](SECURITY.md).

## Entwicklung

```bash
cd server && npm install && npm run dev        # Server auf :8080
cd app    && npm install && npm run dev:web    # Web-App mit Hot-Reload auf :5173 (Proxy zum Server)
npm test                                   # in app/ und server/
```

Aufbau, Architektur und Beitragen: [Entwicklung](docs/entwicklung.md), [CONTRIBUTING.md](CONTRIBUTING.md).

```
app/      React + TypeScript (Vite), PWA und Android (Capacitor, Java-Teile für Handschrift)
server/   Node 22, Fastify, SQLite (node:sqlite), PDF-Erzeugung, Admin-Oberfläche
docs/     Anleitungen
```

## Lizenz und Herkunft

JF Hub steht unter der **GNU Affero General Public License v3.0** ([LICENSE](LICENSE)). Wer eine geänderte Version als Dienst anbietet, muss den Quelltext seiner Änderungen weitergeben.
Der Wettkampf-Teil geht auf [open-JF-Coach](NOTICE.md) zurück. Quellen, Marken und Hinweise stehen in [NOTICE.md](NOTICE.md).
