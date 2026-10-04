# Hinweise, Herkunft und Quellen

## Lizenz

JF Hub steht unter der **GNU Affero General Public License v3.0** (siehe [LICENSE](LICENSE)).

## Herkunft des Wettkampf-Teils

Fehlerkatalog, Aufstellungs-Positionen, Wissensdatenbank und Teile der Wertungslogik gehen auf das Projekt **open-JF-Coach** zurück (ebenfalls AGPL-3.0, vom selben Autor). Sie wurden für JF Hub neu aufgebaut und erweitert (u. a. Leistungsspange, Wasserentnahme Saugleitung/Hydrant, Tests).

## Inoffizielles Projekt – kein Produkt der DJF

JF Hub ist ein unabhängiges Projekt aus der Jugendfeuerwehr-Praxis. Es steht in **keiner Verbindung zur Deutschen Jugendfeuerwehr (DJF)**, zu Landes- oder Kreisjugendfeuerwehren oder zu Herstellern von Feuerwehr-Software. Alle genannten Namen und Marken gehören ihren Inhabern und werden nur zur Beschreibung verwendet.

## Regeln und Wertung: ohne Gewähr

Die Wettkampf-Funktionen (Bundeswettbewerb, Leistungsspange) sind eine **Hilfe beim Training**:

- Inhalte beruhen auf eigener Zusammenfassung folgender Unterlagen der Deutschen Jugendfeuerwehr: Wertungsbögen zum Bundeswettbewerb (Stand 07.09.2013) sowie „Richtlinien zum Erwerb der Leistungsspange“ und „Erläuterungen zur bundeseinheitlichen Durchführung und Bewertung der Leistungsspangenabnahme“ (jeweils Stand 01.01.2024). Die Unterlagen selbst sind nicht Teil dieses Repositorys.
- **Maßgeblich sind immer die aktuellen offiziellen Unterlagen.** Regeln ändern sich; Zusammenfassungen können Fehler enthalten.
- Einige Punktwerte im Fehlerkatalog (Wasserentnahme am Unterflurhydrant) sind **abgeleitet und nicht am Wertungsbogen geprüft**. Die App kennzeichnet sie mit „ungeprüft“. Bitte vor einem Wettkampf abgleichen.
- Für Fehler in Wertungen, Zeiten und Auswertungen besteht keine Haftung (siehe Abschnitte 15–16 der AGPL).

Fehler in den Inhalten kannst du gern als Issue melden, am besten mit Verweis auf die Stelle im offiziellen Dokument.

## Drittanbieter-Software

JF Hub nutzt unter anderem React, Vite, Dexie, TipTap, Capacitor, Lucide (Symbole), Fastify, pdfmake, web-push, fflate sowie in der Android-App androidx.ink und ML Kit Digital Ink Recognition. Ihre Lizenzen (überwiegend MIT, ISC, Apache-2.0) stehen in den jeweiligen Paketen (`node_modules/<paket>/LICENSE`) und lassen sich mit dem Lizenz-Werkzeug deiner Wahl auflisten, z. B. `npx license-checker --production` in `app/` und `server/`.

Die Schulferien-Termine stammen von [OpenHolidays API](https://www.openholidaysapi.org/) (Datenlizenz dort beschrieben).

## Symbol

Das App-Symbol (Flamme) ist eine eigene Grafik für dieses Projekt (`app/assets/`, erzeugt mit `npm run assets`) und unter denselben Bedingungen wie der Quellcode nutzbar.
