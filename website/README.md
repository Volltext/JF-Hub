# Website

[← Dokumentation](../docs/README.md)

Die Projekt-Website für Betreuer, die JF Hub noch nicht kennen: was es kann, wie man drankommt, Datenschutz, häufige Fragen. Sie besteht aus einer statischen Seite ohne Build-Werkzeuge und ohne fremde Schriften, Skripte oder Tracker.

| Datei | Inhalt |
| --- | --- |
| `index.html` | Die ganze Seite (Texte hier ändern) |
| `style.css` | Gestaltung, heller und dunkler Modus |
| `site.js` | Demo-Link einblenden, „Link teilen“ |
| `build.sh` | Stellt die Seite in `_site/` zusammen (mit den Bildern aus `docs/images/` und dem App-Symbol) |

## Veröffentlichen (GitHub Pages)

**Einmalig einrichten**

1. Im Repository unter **Settings → Pages** bei *Source* **GitHub Actions** wählen.
2. Optional: Unter **Settings → Secrets and variables → Actions → Variables** eine Variable `DEMO_URL` anlegen, z. B. `https://demo.deine-domain.de` (siehe [Demo-Instanz](../docs/demo.md)). Ohne sie zeigt die Seite statt „Demo ausprobieren“ einen Link zur Anleitung.
3. Den Workflow **Website veröffentlichen** unter *Actions* einmal von Hand starten (*Run workflow*).

Danach steht die Seite unter `https://<owner>.github.io/<repo>/`, also `https://volltext.github.io/JF-Hub/`. Trag die Adresse am besten auch oben rechts im Repository unter **About → Website** ein.

**Danach** veröffentlicht jeder Push auf `main`, der `website/` oder die Screenshots ändert, die Seite neu. Nach einer Änderung an `DEMO_URL` den Workflow von Hand starten.

> [!TIP]
> Eigene Domain (z. B. `jf-hub.de`)? Unter *Settings → Pages → Custom domain* eintragen, GitHub erklärt dort die DNS-Einträge.

## Lokal ansehen

```bash
DEMO_URL=http://localhost:8080 website/build.sh     # DEMO_URL ist optional
python3 -m http.server -d _site 8000                # dann http://localhost:8000
```

Neue Screenshots kommen aus `docs/images/` (dieselben wie im README); `build.sh` kopiert sie mit.
