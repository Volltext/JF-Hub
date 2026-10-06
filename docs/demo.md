# Demo-Instanz

[← Dokumentation](README.md)

Eine öffentliche Demo lässt Interessierte JF Hub ausprobieren, ohne etwas zu installieren: Link öffnen, auf **„Als Tobias Wagner anmelden“** tippen, umsehen. Der Demo-Modus füllt den Server mit erfundenen Daten der „Jugendfeuerwehr Musterstadt“ und setzt alles jede Nacht zurück.

> [!CAUTION]
> Der Demo-Modus **löscht beim Start und jede Nacht alle Daten** auf diesem Server. Schalte ihn nur auf einer **eigenen, getrennten** Instanz ein, nie auf dem Server deiner Jugendfeuerwehr.

**Auf dieser Seite:** [Was die Demo zeigt](#was-die-demo-zeigt) · [Einrichten](#einrichten) · [Was gesperrt ist](#was-gesperrt-ist) · [Gut zu wissen](#gut-zu-wissen)

## Was die Demo zeigt

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

## Einrichten

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

**4.** Den Link verteilen, z. B. auf der [Website](../website/README.md) (Variable `DEMO_URL`), als QR-Code auf einem Flyer oder bei der Dienstversammlung.

> [!TIP]
> Nur zum Ausprobieren auf dem eigenen Rechner reicht `docker run --rm -p 8080:8080 -e DEMO=1 ghcr.io/volltext/jf-hub:latest`. Danach http://localhost:8080 öffnen.

## Was gesperrt ist

Alle Besucher teilen sich dieselben Zugänge. Damit niemand die anderen aussperrt oder an fremde Daten kommt, antwortet der Server auf diese Aktionen mit *„In der Demo ausgeschaltet.“*:

- eigenes Passwort ändern, andere Geräte abmelden
- Backups anlegen, herunterladen, löschen oder wiederherstellen (ein Backup enthält z. B. die Push-Schlüssel des Servers)
- die beiden Demo-Konten sperren, löschen, zum Betreuer machen oder ihnen ein neues Passwort geben

Alles andere geht wie im echten Betrieb, auch Benutzer einladen, PDF-Layout ändern, Protokolle veröffentlichen und Benachrichtigungen testen. Selbst angelegte Benutzer lassen sich ganz normal verwalten.

## Gut zu wissen

- **Zurücksetzen:** Beim Zurücksetzen werden alle Besucher abgemeldet. Wer die Seite danach öffnet, landet auf der Anmeldung und bekommt nach dem nächsten Klick frische Daten. Auch ein Neustart des Containers setzt die Demo zurück.
- **Anmelde-Begrenzung:** Fehlversuche sperren die Demo-Zugänge nicht. Je Internetadresse sind 60 Anmeldungen in 15 Minuten erlaubt (sonst 8), damit eine ganze Gruppe im selben WLAN gleichzeitig ausprobieren kann.
- **Keine automatischen Backups:** Sie wären am nächsten Morgen ohnehin überholt.
- **`ADMIN_USER` / `ADMIN_PASSWORD`** werden im Demo-Modus ignoriert, einen Setup-Code gibt es nicht.
- **Inhalte von Besuchern:** Bis zum nächsten Zurücksetzen sieht jeder, was andere veröffentlichen, auch Fotos und Anhänge. Wenn dir das zu lang ist, stell `DEMO_RESET_AT` auf eine Uhrzeit, zu der die Demo wenig genutzt wird, und starte den Container bei Bedarf einfach neu.
- **Rechtliches:** Eine öffentlich erreichbare Seite verarbeitet zumindest IP-Adressen. Prüfe, ob du für die Demo-Adresse ein Impressum und einen Datenschutzhinweis brauchst.
