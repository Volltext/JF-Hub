# Cloudflare Tunnel

[← Dokumentation](README.md)

**Der empfohlene Weg zu https.** Ein Cloudflare Tunnel verbindet deinen Server **ausgehend** mit Cloudflare. Dadurch brauchst du

- keine Port-Freigabe am Router und keine feste IP-Adresse,
- kein eigenes Zertifikat: Die Adresse ist automatisch **https**. Das ist die Voraussetzung dafür, dass sich JF Hub als App installieren lässt und **Benachrichtigungen** schickt.

> [!NOTE]
> **Kosten:** Der Tunnel ist kostenlos. Du brauchst einen kostenlosen Cloudflare-Account und eine **Domain**, die bei Cloudflare verwaltet wird. Eine Domain kostet je nach Endung wenige Euro im Jahr; sie kann bei jedem Anbieter gekauft und dann zu Cloudflare umgezogen bzw. mit deren Nameservern verbunden werden.

Keine Domain, kein Cloudflare? Dann schau in die [HTTPS-Alternativen](https-alternativen.md).

## Einrichten

Dauer: etwa 15 Minuten.

**1. Tunnel anlegen**

Im [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/): *Networks* → *Tunnels* → *Create a tunnel* → Typ **Cloudflared**. Einen Namen vergeben (z. B. `jf-hub`).

**2. Token kopieren**

Auf der Seite „Install and run connectors“ **Docker** wählen. In dem angezeigten Befehl steht hinter `--token` ein langer Text – das ist das Token.

**3. Token eintragen**

In der `.env` neben der `docker-compose.yml`:

```ini
TUNNEL_TOKEN=eyJh…
```

**4. Adresse festlegen**

Im Tunnel unter *Public Hostname* → *Add a public hostname*:

| Feld | Wert |
| --- | --- |
| Subdomain / Domain | z. B. `jfhub` + `deine-domain.de` |
| Service **Type** | **HTTP** |
| Service **URL** | **`jf-hub:8080`** |

**5. Starten**

```bash
docker compose --profile tunnel up -d
```

**6. Admin-Konto anlegen**

Öffne `https://jfhub.deine-domain.de/admin/` und leg das Admin-Konto an. Den Setup-Code findest du mit `docker compose logs jf-hub | grep -A2 Ersteinrichtung`.

> [!TIP]
> Der Server braucht jetzt keinen offenen Port mehr. Wenn du ihn nur über den Tunnel erreichen willst, lass `BIND=127.0.0.1` (Standard): Dann ist er im Heimnetz nicht direkt erreichbar.

<details>
<summary><b><code>cloudflared</code> läuft auf einem anderen Rechner?</b></summary>
<br>

Dann trägst du als URL die Adresse des JF-Hub-Rechners ein, z. B. `192.168.1.20:8080`, und setzt auf dem JF-Hub-Rechner `BIND=0.0.0.0`.

</details>

## Prüfen

- [ ] `docker compose logs cloudflared` zeigt „Registered tunnel connection“.
- [ ] `https://jfhub.deine-domain.de/api/health` antwortet mit `{"ok":true,…}`.
- [ ] In der App unter *Einstellungen → Erinnerungen* lässt sich „Benachrichtigungen“ einschalten und mit „Testbenachrichtigung senden“ prüfen.

## Fehlersuche

| Symptom | Ursache und Lösung |
| --- | --- |
| Cloudflare zeigt „502 Bad Gateway“ | Service-URL falsch. Sie muss `http://jf-hub:8080` lauten (Typ **HTTP**, nicht HTTPS), und `cloudflared` muss im selben Compose-Projekt laufen. |
| „Tunnel not connected“ im Dashboard | `TUNNEL_TOKEN` fehlt oder ist abgeschnitten: `docker compose logs cloudflared`. |
| App lässt sich nicht installieren, keine Benachrichtigungen | Du greifst über `http://` oder die IP-Adresse zu. Nur die https-Adresse des Tunnels öffnen. |
| „Zu viele Versuche“ beim Anmelden | Die Begrenzung greift (8 Fehlversuche je 15 Minuten). Warten oder `docker compose restart jf-hub`. |

## Gut zu wissen

- **Verschlüsselung:** Zwischen Browser/App und Cloudflare sowie im Tunnel ist alles verschlüsselt. Cloudflare beendet die Verschlüsselung aber (keine Ende-zu-Ende-Verschlüsselung) und kann den Datenverkehr technisch einsehen. Wer das nicht möchte, nimmt ein VPN wie Tailscale oder einen eigenen Reverse-Proxy: [HTTPS-Alternativen](https-alternativen.md). Beides ist im [Datenschutz](datenschutz.md) beschrieben.
- **Client-Adresse:** Hinter dem Tunnel sieht der Server die echte Adresse der Besucher über `X-Forwarded-For`. Der Standard von `TRUST_PROXY` vertraut diesem Header nur, wenn die Anfrage aus einem privaten Netz (hier: dem Docker-Netz) kommt. So lässt sich die Begrenzung der Anmeldeversuche nicht durch gefälschte Header umgehen.
- **Cloudflare Access (optional):** Du kannst eine zusätzliche Anmeldung vor die **Admin-Oberfläche** setzen (Access-Anwendung für `/admin*` und `/api/admin*`). Setze Access **nicht vor die ganze Adresse**: Die Android-App und die Installation als PWA können keine Access-Anmeldeseite bedienen.
- **Upload-Größe:** Cloudflare erlaubt im Free-Tarif Anfragen bis 100 MB. Fotos werden in der App auf 1600 Pixel verkleinert, ein Protokoll mit Anhängen bleibt weit darunter.
- **Mehrere Tunnel/Hostnamen:** möglich, z. B. ein Hostname für die Betreuer und ein zweiter nur zum Testen.

---

**Als Nächstes:** [Erste Schritte](erste-schritte.md)
