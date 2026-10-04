# Mitmachen bei JF Hub

Danke, dass du helfen möchtest! JF Hub ist ein Gemeinschaftsprojekt aus der Jugendfeuerwehr-Praxis – Fehlerberichte, Ideen, Verbesserungen an Texten und Code sind willkommen.

## Wie kann ich helfen?

- **Fehler melden:** [Issue](../../issues/new/choose) mit dem Bug-Template. Hilfreich: Was hast du erwartet, was ist passiert, welches Gerät/welcher Browser, welche Version (steht unter *Mehr* ganz unten).
- **Idee vorschlagen:** Issue mit dem Feature-Template. Beschreib das Problem aus Sicht der Betreuer („Ich möchte … damit …“).
- **Regeln und Wertung korrigieren:** Issue mit Verweis auf die Stelle im offiziellen DJF-Dokument.
- **Code beitragen:** Fork → Branch → Pull Request.

## Code beitragen

1. Repository forken, Branch anlegen: `git checkout -b fix/kurze-beschreibung`
2. Entwicklungsumgebung: [docs/entwicklung.md](docs/entwicklung.md)
3. Änderungen mit Tests absichern und prüfen:
   ```bash
   cd app    && npm run typecheck && npm test
   cd server && npm run typecheck && npm test
   ```
4. Pull Request öffnen und beschreiben, **was** sich ändert und **warum**. Bei sichtbaren Änderungen bitte einen Screenshot dazu.

### Leitplanken

- **Datensparsamkeit:** Keine Personenstammdaten über Name, Anwesenheit und Kleidergrößen hinaus (keine Geburtsdaten, Adressen, Kontakte). Mehr Daten brauchen eine gute Begründung.
- **Offline zuerst:** Neue Funktionen müssen ohne Netz funktionieren und über den Abgleich auf den Server gelangen.
- **Sichtbarkeit beachten:** Was privat ist, darf nie an andere Benutzer gehen (Server prüft, Tests in `server/src/users.test.ts`).
- **Datenbank:** Dexie-Schema nur mit neuer `version(n)`; Server-Schema nur additiv migrieren.
- **Oberfläche:** Deutsch, eigene Dialoge und Wähler (`core/ui`), große Tippflächen (Bedienung mit Handschuhen/auf dem Platz), Hell/Dunkel.
- **Keine neuen Abhängigkeiten ohne Not**; jede Abhängigkeit muss eine mit AGPL-3.0 verträgliche Lizenz haben.
- **Keine Geheimnisse einchecken** (Schlüssel, Tokens, `.env`).

### Commit-Nachrichten

Kurze, klare Betreffzeile mit Präfix: `Add:` neue Funktion, `Fix:` Fehlerbehebung, `Docs:` Dokumentation, `Refactor:` Umbau ohne neues Verhalten, `Test:` Tests.

## Lizenz

Mit deinem Beitrag stimmst du zu, dass er unter der **AGPL-3.0** des Projekts steht.

## Verhalten

Geh respektvoll miteinander um. Hier arbeiten Ehrenamtliche in ihrer Freizeit – Geduld und Freundlichkeit helfen allen.
