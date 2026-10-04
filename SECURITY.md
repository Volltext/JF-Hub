# Sicherheitsrichtlinie

## Sicherheitslücken melden

Bitte melde Sicherheitslücken **nicht** über öffentliche GitHub-Issues. Nutze stattdessen die **vertrauliche Meldung** des Repositorys: *Security* → *Report a vulnerability* (GitHub Private Vulnerability Reporting). Beschreibe, was du gefunden hast, wie man es nachstellt und welche Version betroffen ist.

Bitte gib uns Zeit für einen Fix, bevor du die Lücke öffentlich machst. Wir melden uns in der Regel innerhalb weniger Tage.

## Was wir als Sicherheitslücke betrachten

- Zugriff auf private Protokolle/Aufgaben anderer Benutzer oder Rechteausweitung (Betreuer → Admin)
- Umgehen der Anmeldung, der Anmelde-Begrenzung oder des CSRF-Schutzes
- Einschleusen von Skripten (XSS) über Protokolltexte, Anhänge, Namen oder die Admin-Oberfläche
- Serverseitige Anfragefälschung (z. B. über Push-Adressen), Pfad- und Injektionslücken
- Preisgabe von Zugangsdaten, Tokens oder Datenbankinhalten

## Was wir nicht als Sicherheitslücke betrachten

- Fehlende Funktionen, Fehler ohne Sicherheitsauswirkung
- Dass der Betreiber des Servers (Admin) als Betreiber Zugriff auf die Datenbank hat – das ist Teil der [Datenschutz-Hinweise](docs/datenschutz.md)
- Probleme, die nur auftreten, wenn der Server über unverschlüsseltes `http://` im offenen Internet betrieben wird

## Unterstützte Versionen

Sicherheitsfixes gibt es für die jeweils **neueste Version**. Aktualisiere regelmäßig ([Installation → Aktualisieren](docs/installation.md)).

## Hinweise für Betreiber

- Betreibe JF Hub nur über **https** (Cloudflare Tunnel, Caddy, Reverse-Proxy, Tailscale).
- Halte das Image aktuell, sichere die Datenbank und das Admin-Konto, sperre Konten ausgeschiedener Betreuer.
- Setze `TRUST_PROXY` nur auf `true`, wenn der Server nie direkt erreichbar ist.
