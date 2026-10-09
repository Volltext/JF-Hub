# Installation

[← Dokumentation](README.md)

JF Hub läuft als **ein Docker-Container** (Server, Web-App und Admin-Oberfläche) mit **einer SQLite-Datei** als Datenbank. Es gibt Images für Intel/AMD (`amd64`) und ARM (`arm64`, z. B. Raspberry Pi 4/5).

**Auf dieser Seite:** [Voraussetzungen](#voraussetzungen) · [Installieren](#installieren) · [Erster Start](#erster-start) · [Einstellungen](#einstellungen) · [Aktualisieren](#aktualisieren) · [Backup](#backup-und-wiederherstellung) · [Passwort vergessen](#passwort-vergessen)

## Voraussetzungen

- [ ] **Docker** mit Compose v2.24 oder neuer (prüfen mit `docker compose version`)
- [ ] Ein Rechner, der **dauerhaft läuft** (NAS, Raspberry Pi, Heimserver, kleiner Cloud-Server)
- [ ] *Für Zugriff von unterwegs, App-Installation und Benachrichtigungen:* eine **https-Adresse** → [Cloudflare Tunnel](cloudflare-tunnel.md) (empfohlen) oder [Alternativen](https-alternativen.md). Zum Ausprobieren brauchst du das nicht.

## Installieren

Such dir den Weg, der zu dir passt. **Variante A** ist die einfachste.

### Variante A: Aus dem Repository (empfohlen)

```bash
git clone https://github.com/Volltext/JF-Hub.git
cd JF-Hub
docker compose up -d
```

Das fertige Image wird von GitHub geladen. Einstellungen sind optional: Wenn du welche ändern willst, kopierst du vorher `cp .env.example .env` und passt die Werte an (siehe [Einstellungen](#einstellungen)).

> [!TIP]
> Lieber selbst bauen? `docker compose up -d --build` baut das Image aus den Quellen.

<details>
<summary><b>Variante B: Nur eine Compose-Datei</b> (ohne <code>git</code>)</summary>
<br>

Lege einen Ordner an (z. B. `jf-hub`) und darin eine Datei `docker-compose.yml`:

```yaml
services:
  jf-hub:
    image: ghcr.io/volltext/jf-hub:latest
    container_name: jf-hub
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"     # fürs Heimnetz: "8080:8080"
    environment:
      TZ: Europe/Berlin
      PUSH_SUBJECT: mailto:deine-adresse@example.org
    volumes:
      - jf-hub-data:/data
    security_opt:
      - no-new-privileges:true

volumes:
  jf-hub-data:
```

Dann `docker compose up -d`.

</details>

<details>
<summary><b>Variante C: Ein einzelner Befehl</b> (<code>docker run</code>)</summary>
<br>

```bash
docker run -d --name jf-hub --restart unless-stopped \
  -p 127.0.0.1:8080:8080 -v jf-hub-data:/data \
  -e PUSH_SUBJECT=mailto:deine-adresse@example.org \
  ghcr.io/volltext/jf-hub:latest
```

</details>

<details>
<summary><b>Variante D: NAS- und Server-Oberflächen</b> (ZimaOS, Portainer, Arcane, Unraid, Synology)</summary>
<br>

Lege einen neuen Stack bzw. ein neues Projekt an und füge den Inhalt aus **Variante B** (oder die `docker-compose.yml` aus dem Repository) ein. Die Variablen aus `.env.example` trägst du im Feld „Environment“ ein.

Für einen festen Datenordner setzt du `DATA_PATH` auf einen Pfad deines Geräts (z. B. `/DATA/AppData/jf-hub` unter ZimaOS).

</details>

## Erster Start

**1. Setup-Code ablesen**

```bash
docker compose logs jf-hub | grep -A2 Ersteinrichtung
```

In einer Docker-Oberfläche findest du ihn unter „Logs“ des Containers.

**2. Admin-Konto anlegen**

Öffne `/admin/` (z. B. `http://localhost:8080/admin/`), gib den Setup-Code ein und lege das erste **Admin-Konto** an. Der Code gilt nur, solange es noch kein Konto gibt – danach kann niemand mehr ein Admin-Konto auf diesem Weg anlegen.

> [!NOTE]
> **Alternative ohne Setup-Code:** Setze `ADMIN_USER` und `ADMIN_PASSWORD` (mindestens 10 Zeichen) in der `.env`. Das Konto wird dann beim allerersten Start angelegt.

**3. Weiter geht's**

1. **Admin → Benutzer:** Betreuer einladen (Link weitergeben, jede Person vergibt ihr Passwort selbst)
2. **Admin → PDF-Layout:** Name der Gruppe, Logo, Fußzeile und Farbe für die PDFs
3. In der App unter **Mitglieder** die Gruppe anlegen

Die Schritte mit Bildern: [Erste Schritte](erste-schritte.md).

## Einstellungen

Alle Werte sind **optional**. Sie stehen in der `.env` neben der `docker-compose.yml` (Vorlage: [`.env.example`](../.env.example)).

| Variable | Bedeutung | Standard |
| --- | --- | --- |
| `JF_HUB_IMAGE` | Image, das Compose startet | `ghcr.io/volltext/jf-hub:latest` |
| `BIND` | Adresse, auf der der Port veröffentlicht wird (`0.0.0.0` = ganzes Heimnetz) | `127.0.0.1` |
| `HOST_PORT` | Port am Rechner | `8080` |
| `DATA_PATH` | Datenordner oder Volume-Name | `jf-hub-data` |
| `TZ` | Zeitzone | `Europe/Berlin` |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Erstes Konto per Umgebung statt Setup-Code | leer |
| `ADMIN_PASSWORD_RESET` | `1` setzt das Passwort von `ADMIN_USER` auf `ADMIN_PASSWORD` (danach wieder `0`) | `0` |
| `PUSH_SUBJECT` | Kontaktadresse für den Push-Dienst der Browser (`mailto:…` oder https-Adresse) – bitte eine eigene eintragen | `mailto:admin@example.com` |
| `TRUST_PROXY` | Welchen Proxys `X-Forwarded-For` geglaubt wird. Leer = nur Proxys aus privaten Netzen. `true` = jedem. `false` = keinem | leer |
| `TUNNEL_TOKEN` | Cloudflare-Tunnel-Token (Profil `tunnel`) | leer |
| `DOMAIN` | Domain für Caddy (`docker-compose.caddy.yml`) | – |

Direkt im Container gibt es außerdem `PORT` (Standard 8080) und `DATA_DIR` (Standard `/data`).

## Aktualisieren

```bash
docker compose pull && docker compose up -d       # Image von GitHub
docker compose up -d --build                      # aus dem Quellcode gebaut (nach git pull)
```

Die Datenbank wird beim Start automatisch auf den neuen Stand gebracht. Mach vor größeren Versionssprüngen ein [Backup](#backup-und-wiederherstellung). Was sich ändert, steht im [CHANGELOG](../CHANGELOG.md).

> [!IMPORTANT]
> **Update auf 2.2.0:** Beim ersten Start lagert der Server alle Fotos und Dateien aus den Protokollen in eigene Einträge aus. Bei vielen Fotos dauert das einen Moment. Vorher legt er ein Backup der Art **„vor Update“** an (im Docker-Image ist der Backup-Ordner eingerichtet); wenn alles läuft, kannst du es löschen, der Server behält die letzten zwei.
>
> **Erst den Server aktualisieren, dann die Apps.** Apps der Version 2.0.x melden danach „Bitte die App aktualisieren“, bis sie neu installiert sind (die Web-App lädt sich selbst). Eine neue App an einem alten Server meldet „Bitte den Server aktualisieren“.

Die App im Browser aktualisiert sich selbst: Beim nächsten Öffnen mit Netz wird die neue Version geladen. Die Android-App bekommt Updates über eine neue APK.

## Backup und Wiederherstellung

Alles liegt in `/data` (Datei `jf-hub.sqlite`).

### Automatisch

Der Server legt **täglich** ein Backup in `/data/backups` an und behält die letzten 7 (einstellbar unter *Admin → Backup & Export*, `0` schaltet es ab).

> [!WARNING]
> Diese Backups schützen vor Fehlern und versehentlichem Löschen, **nicht** vor dem Ausfall der Festplatte: Sie liegen im selben Volume. Lade ab und zu ein Backup herunter oder sichere das Volume an anderer Stelle.

### In der Oberfläche

*Admin → Backup & Export*:

- Backups ansehen, herunterladen, löschen
- **Jetzt sichern** legt sofort eins an
- **Alle Protokolle als ZIP** liefert eine lesbare Kopie mit PDFs
- **Wiederherstellen** bei einem Backup, oder eine heruntergeladene Datei unter *Aus Datei wiederherstellen* hochladen

Vor jeder Wiederherstellung sichert der Server den aktuellen Stand (Art „vor Wiederherstellung“, die letzten 3 bleiben). Danach gleichen sich alle Geräte neu ab. Benutzer und Anmeldungen stammen aus dem Backup, wer dort fehlt, meldet sich neu an. Auch Backups älterer Versionen lassen sich einspielen.

<details>
<summary><b>Über das Volume oder von Hand</b></summary>
<br>

**Volume sichern:**

```bash
docker run --rm -v jf-hub-data:/data -v "$PWD":/backup alpine tar czf /backup/jf-hub-backup.tgz -C /data .
```

**Von Hand wiederherstellen** (falls die Oberfläche nicht erreichbar ist): Container stoppen, die Datei als `/data/jf-hub.sqlite` zurücklegen (Rechte: Benutzer `node`, wird beim Start automatisch gesetzt), Container starten.

</details>

> [!CAUTION]
> Sichere das Backup nicht ungeschützt in einer Cloud: Es enthält Namen von Jugendlichen (siehe [Datenschutz](datenschutz.md)).

## Passwort vergessen?

| Wer | So geht's |
| --- | --- |
| **Ein Betreuer** | *Admin → Benutzer → Passwort zurücksetzen* erzeugt einen neuen Einladungslink |
| **Der einzige Admin** | `ADMIN_USER=<name>`, `ADMIN_PASSWORD=<neues Passwort>` und `ADMIN_PASSWORD_RESET=1` setzen, Container neu starten. Danach `ADMIN_PASSWORD_RESET` wieder auf `0` setzen und das Passwort aus der `.env` löschen |

## Mehrere Gruppen

Eine Instanz gehört zu **einer** Gruppe. Für mehrere Gruppen startest du mehrere Container mit eigenem Volume, Port und Tunnel.

---

**Als Nächstes:** [Erste Schritte](erste-schritte.md) · [Von unterwegs erreichbar machen](cloudflare-tunnel.md)
