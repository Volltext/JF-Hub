# Benutzer und Sichtbarkeit

## Rollen

| | Betreuer | Admin |
| --- | :---: | :---: |
| Protokolle, Dienste, Aufgaben, Mitglieder, Kleidung nutzen | ✓ | ✓ |
| Eigenes Passwort ändern, eigene Geräte abmelden | ✓ | ✓ |
| Benutzer einladen, sperren, löschen, Rollen ändern | | ✓ |
| PDF-Layout, Laufzeiten, Backup, Geräte aller Benutzer | | ✓ |
| Veröffentlichte Protokolle/Aufgaben anderer **löschen** | | ✓ |

Es muss immer mindestens ein aktiver Admin übrig bleiben. Den ersten Admin legst du bei der [Installation](installation.md) mit dem Setup-Code an.

## Betreuer einladen

1. **Admin-Oberfläche** (`/admin/`) → **Benutzer** → Benutzername und Anzeigename eintragen → „Betreuer einladen“.
2. Es erscheint ein **Einladungslink** (gültig 7 Tage, einmal verwendbar). Gib ihn der Person, z. B. per Messenger.
3. Die Person öffnet den Link, vergibt ihr **eigenes Passwort** (mindestens 10 Zeichen) und ist angemeldet. Der Admin kennt nie ein Passwort.

In der Android-App löst man die Einladung unter *Einstellungen → Server & Konto → Einladung einlösen* ein (Adresse, Benutzername und Code aus der Einladung).

**Passwort vergessen?** Admin → Benutzer → „Passwort zurücksetzen“ erzeugt einen neuen Link. Das alte Passwort gilt, bis der Link benutzt wird; danach sind alle Geräte der Person abgemeldet.

**Sperren** beendet sofort alle Anmeldungen der Person. **Löschen** entfernt das Konto: Ihre *privaten* Protokolle und Aufgaben werden gelöscht, *veröffentlichte* gehören danach dem Admin, der gelöscht hat.

Benutzernamen unterscheiden nicht zwischen Groß- und Kleinschreibung (3–32 Zeichen: Buchstaben, Ziffern, `.`, `_`, `-`).

## Wer sieht was?

| Daten | Sichtbarkeit |
| --- | --- |
| Mitglieder, Dienste (Anwesenheit), Kleidergrößen, Wettkampf-Läufe, Aufstellungs-Vorlagen | immer für alle Betreuer |
| Ordner für Protokolle | für alle (nur die Struktur, nicht der Inhalt privater Protokolle) |
| **Protokolle** | **privat** (nur du) oder **veröffentlicht** (alle Betreuer) |
| **Aufgaben** | **privat** oder **veröffentlicht** |
| Laufende Stoppuhr, aktuelle Aufstellung und Wertung | nur auf dem jeweiligen Gerät (Arbeitsstand, wird nicht abgeglichen) |

Neue Protokolle und Aufgaben sind **zuerst privat**. Wer lieber gleich für alle schreibt, stellt das unter *Einstellungen → Darstellung & neue Einträge* um (gilt nur für das eigene Konto/Gerät).

### Veröffentlichen und zurücknehmen

- **Protokoll:** Im Editor oben auf das Schloss-/Gruppen-Symbol tippen → „Für alle Betreuer veröffentlichen“.
- **Aufgabe:** Beim Anlegen/Bearbeiten „Für alle Betreuer veröffentlichen“ einschalten.
- **Zurücknehmen:** Das Symbol erneut öffnen → „Wieder privat machen“. Der Eintrag verschwindet bei den anderen Betreuern beim nächsten Abgleich.

### Zusammen arbeiten

- Veröffentlichte Einträge dürfen **alle bearbeiten** (Text ändern, Aufgabe abhaken). Aufgaben zeigen, wer sie erledigt hat.
- **Sichtbarkeit ändern und löschen** darf nur der **Besitzer** (löschen zusätzlich der Admin, z. B. wenn jemand die Gruppe verlässt).
- Bearbeiten zwei Personen dasselbe Protokoll gleichzeitig, bleibt die zuerst gespeicherte Fassung und die andere wird als Kopie „… (Konflikt)“ gesichert. Es geht nichts verloren. Bei Aufgaben gilt die letzte Änderung.

### Was kann der Admin sehen?

Der Admin hat in der Oberfläche **keinen Einblick in private Protokolle und Aufgaben** anderer: Listen, PDF und ZIP-Export zeigen nur Veröffentlichtes und Eigenes. Technisch hat er als Betreiber des Servers aber Zugriff auf die Datenbank – das Datenbank-Backup enthält alles. Das gehört in die Absprache mit der Gruppe (siehe [Datenschutz](datenschutz.md)).

## Geteilte Geräte

Beim **Abmelden** wird zuerst ein letzter Abgleich versucht und danach werden Protokolle, Aufgaben, Mitglieder, Dienste, Kleidergrößen, Wettkampf-Läufe und Vorlagen vom Gerät **gelöscht**. Die Daten liegen weiter auf dem Server und kommen bei der nächsten Anmeldung zurück. Meldet sich jemand anderes an, bekommt er nie Daten des Vorgängers zu sehen und lädt nichts unter falschem Namen hoch.

Hat ein Gerät noch nicht gesendete Änderungen (kein Netz), warnt die App vor dem Abmelden.

Nicht gelöscht werden die Einstellungen sowie die laufende Stoppuhr, die aktuelle Aufstellung und Wertung dieses Geräts.

## Geräte verwalten

Jeder Betreuer sieht unter *Einstellungen → Konto → Meine Geräte* seine Anmeldungen und kann einzelne oder alle anderen abmelden (z. B. bei einem verlorenen Handy). Der Admin sieht in der Oberfläche alle Geräte aller Benutzer. Anmeldungen laufen nach 90 Tagen ohne Nutzung ab (einstellbar).
