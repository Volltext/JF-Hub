# Website

[← Dokumentation](../docs/README.md)

Die Projekt-Website für Betreuer, die JF Hub noch nicht kennen: was es kann, wie man drankommt, Datenschutz, häufige Fragen. Dazu gehört unter `demo/` die [Demo im Browser](../docs/demo.md#demo-im-browser): die echte App mit Beispieldaten, ganz ohne Server. Die Seite selbst ist statisch, ohne Build-Werkzeuge und ohne fremde Schriften, Skripte oder Tracker.

| Datei | Inhalt |
| --- | --- |
| `index.html` | Die ganze Seite (Texte hier ändern) |
| `style.css` | Gestaltung, heller und dunkler Modus |
| `site.js` | Demo-Link einblenden, „Link teilen“ |
| `build.sh` | Stellt die Seite in `_site/` zusammen: Bilder aus `docs/images/`, App-Symbol und die Demo aus `app/dist-demo` |

## Veröffentlichen (GitHub Pages)

**Einmalig einrichten**

1. Im Repository unter **Settings → Pages** bei *Source* **GitHub Actions** wählen.
2. Optional, nur wenn du einen [Demo-Server](../docs/demo.md#demo-server) betreibst: Unter **Settings → Secrets and variables → Actions → Variables** eine Variable `DEMO_URL` anlegen, z. B. `https://demo.deine-domain.de`. Die Demo-Knöpfe führen dann dorthin statt zur Demo im Browser.
3. Den Workflow **Website veröffentlichen** unter *Actions* einmal von Hand starten (*Run workflow*).

Danach steht die Seite unter `https://<owner>.github.io/<repo>/`, also `https://volltext.github.io/JF-Hub/`. Trag die Adresse am besten auch oben rechts im Repository unter **About → Website** ein.

**Danach** veröffentlicht jeder Push auf `main`, der `website/`, die Screenshots oder die App ändert, die Seite neu – die Demo ist also immer auf dem Stand von `main`. Nach einer Änderung an `DEMO_URL` den Workflow von Hand starten.

> [!TIP]
> Eigene Domain (z. B. `jf-hub.de`)? Unter *Settings → Pages → Custom domain* eintragen, GitHub erklärt dort die DNS-Einträge.

## Lokal ansehen

```bash
(cd app && npm ci && npm run build:demo)            # Demo im Browser bauen
website/build.sh                                    # Seite in _site/ zusammenstellen
python3 -m http.server -d _site 8000                # dann http://localhost:8000 (Demo unter /demo/)
```

Nur an der Demo arbeiten: `cd app && npm run dev:demo` (mit Hot-Reload).

Neue Screenshots kommen aus `docs/images/` (dieselben wie im README); `build.sh` kopiert sie mit.
