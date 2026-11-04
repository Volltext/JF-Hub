# Demo

[← Dokumentation](README.md)

Interessierte sollen JF Hub ausprobieren können, ohne etwas zu installieren. Dafür gibt es zwei Wege mit denselben erfundenen Daten der „Jugendfeuerwehr Musterstadt“:

| | Demo im Browser | Demo-Server |
| --- | --- | --- |
| Wo | auf der [Website](../website/README.md) unter `/demo/` | eigener Server mit `DEMO=1` |
| Aufwand | keiner, kommt mit GitHub Pages | Container, Domain, Tunnel |
| Daten | nur im Browser des Besuchers, „Zurücksetzen“ per Knopf | auf dem Server, für alle Besucher gemeinsam, täglich zurückgesetzt |
| Zeigt | die ganze App (Dienste, Protokolle, Aufgaben, Kleidung, Wettkampf) | zusätzlich PDFs, Benachrichtigungen, mehrere Betreuer, Server-Verwaltung |

**Auf dieser Seite:** [Demo im Browser](#demo-im-browser) · [Demo-Server](#demo-server): [Was er zeigt](#was-die-demo-zeigt) · [Einrichten](#einrichten) · [Was gesperrt ist](#was-gesperrt-ist) · [Gut zu wissen](#gut-zu-wissen)

## Demo im Browser

Die App wird zusätzlich im Modus `demo` gebaut (`cd app && npm run build:demo`, Ausgabe in `app/dist-demo`). Die Website veröffentlicht sie unter `…/JF-Hub/demo/`. Der Workflow `pages.yml` erledigt das bei jedem Push auf `main`.

- **Keine Anmeldung:** Besucher sind gleich Jana Becker, die Jugendwartin. Beim ersten Öffnen legt die App die Beispieldaten im Browser an (IndexedDB); privates von Tobias gibt es hier nicht.
- **Nichts verlässt den Browser:** Die Demo spricht mit keinem Server, auch nicht mit fremden Diensten. Was ein Besucher einträgt, sieht niemand sonst.
- **Zurücksetzen:** Die Leiste oben hat den Knopf „Zurücksetzen“. Er legt die Beispieldaten neu an, passend zum aktuellen Tag.
- **Was fehlt:** PDFs, Benachrichtigungen, Abgleich zwischen Geräten und die Verwaltung brauchen den Server. In der Demo erscheint dort ein kurzer Hinweis.

Die Beispieldaten stehen in `server/src/demoData.ts`. App und Server nutzen dieselbe Datei; Änderungen dort gelten für beide Demos.

## Demo-Server

Ein Server im Demo-Modus zeigt alles, auch die Verwaltung unter `/admin/`: Link öffnen, auf **„Als Tobias Wagner anmelden“** tippen, umsehen. Er füllt sich mit den Beispieldaten und setzt alles jede Nacht zurück.

> [!CAUTION]
> Der Demo-Modus **löscht beim Start und jede Nacht alle Daten** auf diesem Server. Schalte ihn nur auf einer **eigenen, getrennten** Instanz ein, nie auf dem Server deiner Jugendfeuerwehr.

### Was die Demo zeigt

Beim Start und täglich um **03:00 Uhr** (einstellbar) legt der Server diese Beispieldaten neu an:

| Bereich | Inhalt |
| --- | --- |
| Mitglieder | 15 Jugendliche (eine Person ausgetreten) und 3 Betreuer |
| Dienste | 10 Dienste der letzten Wochen (montags, mit Herbstferien), Anwesenheit mit Statistik |
| Aufgaben | offene, erledigte und private Aufgaben, fällig in den nächsten Tagen |
| Kleidung | Größen für alle, offene und schon weitergegebene Wünsche |
| Protokolle | Dienstabende, Betreuerbesprechung, Elternabend in Ordnern, dazu zwei private Notizen |
| Wettkampf | A-Teil-Läufe mit Fehlerwertung (werden schneller und sauberer), B-Teil, Leistungsspange, zwei Aufstellungs-Vorlagen |

Alle Daten sind relativ zum aktuellen Tag datiert, die Demo sieht also immer aktuell aus.

**Zugänge** (die Anmeldeseiten zeigen sie als Knöpfe):

| Benutzer | Passwort | Rolle |
| --- | --- | --- |
| `jugendwart` | `jfhub-demo` | Admin, Jana Becker: App **und** Server-Verwaltung unter `/admin/` |
| `betreuer` | `jfhub-demo` | Betreuer, Tobias Wagner: nur die App |

Oben in der App steht die ganze Zeit: *„Demo · Bitte keine echten Daten eintragen“*.

### Einrichten

Am einfachsten als eigener kleiner Stack mit [Cloudflare Tunnel](cloudflare-tunnel.md). Er läuft auch neben deiner echten Installation auf demselben Rechner, weil Container, Volume und Adresse getrennt sind.

**1.** Einen neuen Ordner anlegen (z. B. `jf-hub-demo`) und darin eine `docker-compose.yml`:

```yaml
services:
  jf-hub-demo:
    image: ghcr.io/volltext/jf-hub:latest
    container_name: jf-hub-demo
    restart: unless-stopped
    environment:
      TZ: Europe/Berlin
      DEMO: "1"
      DEMO_RESET_AT: "03:00"        # Uhrzeit des täglichen Zurücksetzens
      PUSH_SUBJECT: mailto:deine-adresse@example.org
    volumes:
      - jf-hub-demo-data:/data
    security_opt:
      - no-new-privileges:true

  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: jf-hub-demo-cloudflared
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    depends_on:
      - jf-hub-demo

volumes:
  jf-hub-demo-data:
```

**2.** Einen **eigenen** Tunnel anlegen (wie in [Cloudflare Tunnel](cloudflare-tunnel.md) beschrieben), das Token in eine `.env` im selben Ordner schreiben und als *Public Hostname* z. B. `demo.deine-domain.de` → Dienst `HTTP` `jf-hub-demo:8080` eintragen.

**3.** Starten und prüfen:

```bash
docker compose up -d
docker compose logs jf-hub-demo | grep -A3 DEMO
```

Im Log steht `DEMO-MODUS` mit Uhrzeit und Zugängen. Öffne die Adresse: Die Anmeldeseite zeigt die beiden Knöpfe.

**4.** Den Link verteilen, z. B. auf der [Website](../website/README.md) (Variable `DEMO_URL`: die Demo-Knöpfe führen dann hierher statt zur Demo im Browser), als QR-Code auf einem Flyer oder bei der Dienstversammlung.

> [!TIP]
> Nur zum Ausprobieren auf dem eigenen Rechner reicht `docker run --rm -p 8080:8080 -e DEMO=1 ghcr.io/volltext/jf-hub:latest`. Danach http://localhost:8080 öffnen.

### Was gesperrt ist

Alle Besucher teilen sich dieselben Zugänge. Damit niemand die anderen aussperrt oder an fremde Daten kommt, antwortet der Server auf diese Aktionen mit *„In der Demo ausgeschaltet.“*:

- eigenes Passwort ändern, andere Geräte abmelden
- Backups anlegen, herunterladen, löschen oder wiederherstellen (ein Backup enthält z. B. die Push-Schlüssel des Servers)
- die beiden Demo-Konten sperren, löschen, zum Betreuer machen oder ihnen ein neues Passwort geben

Alles andere geht wie im echten Betrieb, auch Benutzer einladen, PDF-Layout ändern, Protokolle veröffentlichen und Benachrichtigungen testen. Selbst angelegte Benutzer lassen sich ganz normal verwalten.

### Gut zu wissen

- **Zurücksetzen:** Beim Zurücksetzen werden alle Besucher abgemeldet. Wer die Seite danach öffnet, landet auf der Anmeldung und bekommt nach dem nächsten Klick frische Daten. Auch ein Neustart des Containers setzt die Demo zurück.
- **Anmelde-Begrenzung:** Fehlversuche sperren die Demo-Zugänge nicht. Je Internetadresse sind 60 Anmeldungen in 15 Minuten erlaubt (sonst 8), damit eine ganze Gruppe im selben WLAN gleichzeitig ausprobieren kann.
- **Keine automatischen Backups:** Sie wären am nächsten Morgen ohnehin überholt.
- **`ADMIN_USER` / `ADMIN_PASSWORD`** werden im Demo-Modus ignoriert, einen Setup-Code gibt es nicht.
- **Gemeinsam schreiben:** Meldest du dich in zwei Fenstern mit den beiden Zugängen an (Jugendwart und Betreuer) und öffnest dasselbe Protokoll, siehst du, wie das gemeinsame Schreiben funktioniert: Tippen erscheint im anderen Fenster nach wenigen Sekunden, und über dem Text steht, wer noch im Protokoll ist („Tobias Wagner ist auch hier“). Mit demselben Zugang in beiden Fenstern läuft das Zusammenführen genauso, nur die Anzeige „… ist auch hier“ bleibt aus, weil der Server Geräte derselben Person nicht zählt. Bei der Demo im Browser (ohne Server) bleibt alles auf dem eigenen Gerät.
- **Inhalte von Besuchern:** Bis zum nächsten Zurücksetzen sieht jeder, was andere veröffentlichen, auch Fotos (in der Demo nur bis 2 MB; Dateianhänge sind ausgeschaltet). Wenn dir das zu lang ist, stell `DEMO_RESET_AT` auf eine Uhrzeit, zu der die Demo wenig genutzt wird, und starte den Container bei Bedarf einfach neu.
- **Rechtliches:** Eine öffentlich erreichbare Seite verarbeitet zumindest IP-Adressen. Prüfe, ob du für die Demo-Adresse ein Impressum und einen Datenschutzhinweis brauchst.
