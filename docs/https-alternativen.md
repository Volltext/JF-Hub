# HTTPS ohne Cloudflare

Browser aktivieren **Installation als App, Service Worker (Offline-Betrieb) und Benachrichtigungen nur über https** (oder `localhost`). Wer JF Hub nur per `http://192.168.x.x:8080` im Heimnetz nutzt, kann zwar die Seite benutzen, aber **nicht** als App installieren und bekommt **keine** Benachrichtigungen – und die Anmeldung läuft unverschlüsselt durchs Netz.

JF Hub braucht dafür nur eines: Die Verbindung zum Browser muss https sein, wie sie zustande kommt, ist egal. Der Haupt-Weg ist der [Cloudflare Tunnel](cloudflare-tunnel.md). Diese Seite beschreibt die Alternativen.

## Eigene Domain mit Caddy (automatisches Zertifikat)

Voraussetzung: Eine Domain (oder DynDNS-Name), die auf deinen Server zeigt, und freie Ports 80 und 443.

```bash
# .env
DOMAIN=jfhub.example.org

docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

Caddy holt und erneuert das Zertifikat bei Let's Encrypt selbst und ist der einzige Container mit offenen Ports. Das mitgelieferte `docker/Caddyfile` ist drei Zeilen lang.

## Du hast schon einen Reverse-Proxy

Nginx Proxy Manager, Traefik, Caddy, nginx, HAProxy … Leite die Adresse an `http://jf-hub:8080` (oder `http://<server>:8080`) weiter. Wichtig:

- **`Host`, `X-Forwarded-For` und `X-Forwarded-Proto` weiterreichen.** Die meisten Proxys tun das von selbst. `X-Forwarded-Proto: https` sorgt dafür, dass das Anmelde-Cookie als `Secure` gesetzt wird.
- **`TRUST_PROXY`:** Steht der Proxy im selben Docker-Netz oder in deinem Heimnetz, passt der Standard. Kommt er aus einem anderen Netz, trage dessen Adresse ein (`TRUST_PROXY=203.0.113.7` oder ein Netz wie `10.0.0.0/8`). `true` nur, wenn der Server **nie** direkt erreichbar ist.
- Keine Pfad-Präfixe: JF Hub muss unter dem Hauptpfad `/` einer (Sub-)Domain laufen.
- Maximale Anfragegröße mindestens **64 MB** erlauben (Sync mit Fotos).
- Beispiel nginx:

```nginx
server {
  server_name jfhub.example.org;
  client_max_body_size 64m;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Tailscale (privates Netz, kein öffentlicher Zugang)

Mit [Tailscale](https://tailscale.com/) erreichen nur Geräte in deinem privaten Netz den Server – auch von unterwegs, ohne dass er im Internet steht. Tailscale bringt gültige https-Zertifikate mit:

```bash
# auf dem Server (Tailscale installiert, HTTPS in der Tailscale-Admin-Konsole aktiviert)
tailscale serve --bg 8080
```

Das veröffentlicht JF Hub unter `https://<server>.<tailnet>.ts.net`. Jeder Betreuer braucht dann Tailscale auf seinem Gerät. Mit `tailscale funnel` wird die Adresse öffentlich (ohne Tailscale auf dem Gerät).

## Nur Heimnetz, ohne https

Geht, mit Einschränkungen (siehe oben). Zum Ausprobieren und für die reine Nutzung am Laptop reicht `http://<server-ip>:8080`; setze dafür `BIND=0.0.0.0`.

Die **Android-App** akzeptiert `http://` ausschließlich für Adressen im Heimnetz (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`, `.local`, `.lan`, `localhost`) und nutzt für alles andere nur https. Für die App sind Benachrichtigungen unabhängig von https möglich, weil sie lokal geplant werden.

## Selbst signierte Zertifikate

Sie funktionieren mit Browsern nur, wenn das Zertifikat auf jedem Gerät als vertrauenswürdig installiert ist, und auf dem iPhone sind Benachrichtigungen damit praktisch nicht nutzbar. Nimm besser Caddy oder Tailscale.

## Prüfliste: Funktioniert alles?

- [ ] `https://…/api/health` antwortet.
- [ ] Der Browser bietet „App installieren“ bzw. „Zum Startbildschirm“ an.
- [ ] *Einstellungen → Erinnerungen → Benachrichtigungen einschalten* → *Testbenachrichtigung senden* erscheint.
- [ ] Nach dem Anmelden: Flugmodus an, App öffnen – Protokolle und Aufgaben sind weiter da (Offline-Betrieb über den Service Worker).
