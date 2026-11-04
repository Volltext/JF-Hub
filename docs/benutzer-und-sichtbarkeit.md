# Benutzer und Sichtbarkeit

[← Dokumentation](README.md)

**Kurz gesagt:** Jeder Betreuer hat ein eigenes Konto. Mitglieder, Dienste und Kleidung gehören der ganzen Gruppe. Protokolle und Aufgaben sind zuerst **privat** und werden von dir **veröffentlicht**, wenn die anderen sie sehen sollen.

**Auf dieser Seite:** [Rollen](#rollen) · [Betreuer einladen](#betreuer-einladen) · [Wer sieht was?](#wer-sieht-was) · [Zusammen arbeiten](#zusammen-arbeiten) · [Geteilte Geräte](#geteilte-geräte) · [Geräte verwalten](#geräte-verwalten)

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

<img src="images/admin-benutzer.png" alt="Admin-Oberfläche: Benutzerliste" width="720">

1. **Admin-Oberfläche** (`/admin/`) → **Benutzer** → Benutzername und Anzeigename eintragen → **Betreuer einladen**.
2. Es erscheint ein **Einladungslink** (gültig 7 Tage, einmal verwendbar). Gib ihn der Person, z. B. per Messenger.
3. Die Person öffnet den Link, vergibt ihr **eigenes Passwort** (mindestens 10 Zeichen) und ist angemeldet. Der Admin kennt nie ein Passwort.

In der Android-App löst man die Einladung unter *Einstellungen → Server & Konto → Einladung einlösen* ein (Adresse, Benutzername und Code aus der Einladung).

Benutzernamen unterscheiden nicht zwischen Groß- und Kleinschreibung (3–32 Zeichen: Buchstaben, Ziffern, `.`, `_`, `-`).

### Passwort vergessen, Konto sperren oder löschen

| Aktion | Was passiert |
| --- | --- |
| **Passwort zurücksetzen** | Der Admin erzeugt unter *Benutzer* einen neuen Link. Das alte Passwort gilt, bis der Link benutzt wird; danach sind alle Geräte der Person abgemeldet. |
| **Sperren** | Beendet sofort alle Anmeldungen der Person. |
| **Löschen** | Entfernt das Konto. Ihre *privaten* Protokolle und Aufgaben werden gelöscht, *veröffentlichte* gehören danach dem Admin, der gelöscht hat. |

## Wer sieht was?

| Daten | Sichtbarkeit |
| --- | --- |
| Mitglieder, Dienste (Anwesenheit), Kleidergrößen, Wettkampf-Läufe, Aufstellungs-Vorlagen | immer für **alle** Betreuer |
| Ordner für Protokolle | für alle (nur die Struktur, nicht der Inhalt privater Protokolle) |
| **Protokolle** | **privat** (nur du) oder **veröffentlicht** (alle Betreuer) |
| **Aufgaben** | **privat** oder **veröffentlicht** |
| **Stoppuhr** (laufende Zeit, Zwischenzeiten, Fehler, Notizen) | **live für alle** Betreuer: alle sehen dieselbe Stoppuhr je Modus |
| Aktuelle Aufstellung, Leistungsspangen-Variante | nur auf dem jeweiligen Gerät (Arbeitsstand, wird nicht abgeglichen) |

### Live-Stoppuhr

Sind mehrere Betreuer angemeldet, sehen alle **dieselbe Stoppuhr**: Startet einer den A-Teil, läuft die Zeit auf allen Handys mit derselben Anzeige mit (die App gleicht die Uhren der Geräte mit dem Server ab, eine falsch gehende Handyuhr spielt keine Rolle). Jeder kann stoppen, Zwischenzeiten setzen, Fehler eintragen oder den Lauf speichern. Tragen zwei gleichzeitig Fehler ein, zählen beide. Speichern zwei gleichzeitig, entsteht ein Lauf, nicht zwei.

- In der Uhr-Karte steht **„● Live“**, darunter, wer zuletzt etwas geändert hat.
- Läuft die Stoppuhr in einem anderen Modus (z. B. B-Teil, während du den A-Teil offen hast), zeigt die App das an; ein Tipp wechselt dorthin.
- **Ohne Netz** arbeitet die Stoppuhr normal weiter. Was du offline eingibst, wird nachgereicht, sobald der Server wieder erreichbar ist, auch nach einem Neustart der App. Hat inzwischen jemand anderes den Lauf gespeichert oder zurückgesetzt, verfallen die offline gemachten Eingaben zu diesem Lauf, damit sie nicht im nächsten landen.
- Ohne Server (nur Android-App) bleibt die Stoppuhr wie bisher auf dem Gerät.

Neue Protokolle und Aufgaben sind **zuerst privat**. Wer lieber gleich für alle schreibt, stellt das unter *Einstellungen → Darstellung & neue Einträge* um (gilt nur für das eigene Konto und Gerät).

### Veröffentlichen und zurücknehmen

| | Veröffentlichen | Zurücknehmen |
| --- | --- | --- |
| **Protokoll** | Im Editor oben auf das Symbol mit den zwei Personen tippen → **Für alle Betreuer veröffentlichen** | Das Symbol erneut öffnen → **Wieder privat machen** |
| **Aufgabe** | Beim Anlegen oder Bearbeiten **Für alle Betreuer veröffentlichen** einschalten | Aufgabe bearbeiten und den Schalter wieder ausschalten |

Zurückgenommene Einträge verschwinden bei den anderen Betreuern beim nächsten Abgleich.

### Was kann der Admin sehen?

> [!IMPORTANT]
> Der Admin hat in der Oberfläche **keinen Einblick in private Protokolle und Aufgaben** anderer: Listen, PDF und ZIP-Export zeigen nur Veröffentlichtes und Eigenes. Technisch hat er als Betreiber des Servers aber Zugriff auf die Datenbank – das Datenbank-Backup enthält alles. Das gehört in die Absprache mit der Gruppe (siehe [Datenschutz](datenschutz.md)).

## Zusammen arbeiten

- Veröffentlichte Einträge dürfen **alle bearbeiten** (Text ändern, Aufgabe abhaken). Aufgaben zeigen, wer sie erledigt hat.
- **Sichtbarkeit ändern und löschen** darf nur der **Besitzer** (löschen zusätzlich der Admin, z. B. wenn jemand die Gruppe verlässt).
- Bearbeiten zwei Personen dasselbe Protokoll gleichzeitig, bleibt die zuerst gespeicherte Fassung und die andere wird als Kopie „… (Konflikt)“ gesichert. **Es geht nichts verloren.** Bei Aufgaben gilt die letzte Änderung.

## Geteilte Geräte

Beim **Abmelden** wird zuerst ein letzter Abgleich versucht. Danach werden Protokolle, Aufgaben, Mitglieder, Dienste, Kleidergrößen, Wettkampf-Läufe und Vorlagen vom Gerät **gelöscht**. Die Daten liegen weiter auf dem Server und kommen bei der nächsten Anmeldung zurück. Meldet sich jemand anderes an, bekommt er nie Daten des Vorgängers zu sehen und lädt nichts unter falschem Namen hoch.

Hat ein Gerät noch nicht gesendete Änderungen (kein Netz), warnt die App vor dem Abmelden.

Nicht gelöscht werden die Einstellungen sowie die laufende Stoppuhr, die aktuelle Aufstellung und Wertung dieses Geräts.

## Geräte verwalten

Jeder Betreuer sieht unter *Einstellungen → Konto → Meine Geräte* seine Anmeldungen und kann einzelne oder alle anderen abmelden (z. B. bei einem verlorenen Handy). Der Admin sieht in der Oberfläche alle Geräte aller Benutzer. Anmeldungen laufen nach 90 Tagen ohne Nutzung ab (einstellbar).

---

**Mehr dazu:** [Datenschutz](datenschutz.md) · [Erste Schritte](erste-schritte.md)
