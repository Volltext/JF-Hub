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
| Fotos und Dateien in Protokollen | wie das Protokoll, in dem sie stehen (nimmst du es zurück, sehen die anderen auch die Fotos nicht mehr) |
| **Aufgaben** | **privat** oder **veröffentlicht** |
| Laufende Stoppuhr, aktuelle Aufstellung und Wertung | nur auf dem jeweiligen Gerät (Arbeitsstand, wird nicht abgeglichen) |

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
- **Gemeinsam schreiben:** Mehrere Betreuer können dasselbe Protokoll gleichzeitig bearbeiten. Ist es offen, erscheinen die Änderungen der anderen nach wenigen Sekunden, und über dem Text steht, wer noch im Protokoll ist („Anna und Ben sind auch hier“). Schreibt jemand ohne Netz weiter (etwa im Zeltlager), läuft sein Text beim nächsten Abgleich mit dem der anderen zusammen, auch wenn dieselbe Stelle geändert wurde. Dafür gibt es keine „… (Konflikt)“-Kopien mehr, und **es geht nichts verloren**. Ohne Netz zeigt der Editor „Offline“; die Änderungen liegen auf dem Gerät und gehen beim nächsten Abgleich zum Server. Ein Protokoll, dessen Text das Gerät noch nie geladen hat, lässt sich ohne Netz nur lesen.
- **Titel, Datum, Beginn, Ende, Ort, Leitung, Ordner und Sichtbarkeit** werden Feld für Feld zusammengeführt: Ändert eine Person den Ort und eine andere den Titel, bleiben beide Änderungen. Ändern beide dasselbe Feld, gilt die spätere. Bei Aufgaben gilt die letzte Änderung.
- **Kopie „… (lokale Fassung)“:** Passt dein ungesendeter Text nirgends mehr hin, sichert die App ihn als eigenes Protokoll und sagt es dir. Das passiert, wenn das Protokoll gelöscht oder zurückgezogen wurde, während du offline daran geschrieben hast, wenn der Server aus einer Sicherung wiederhergestellt wurde, oder nach dem Update von einer Version vor 3.0.0, wenn dein Gerät noch Änderungen hatte, die der Server nie bekommen hat. Übernimm daraus, was du brauchst. Die Karte **Gleichzeitig bearbeitet** oben in der Protokollliste gibt es nur noch für Kopien „… (Konflikt)“ aus früheren Versionen; sie bleibt, bis du **Verstanden** tippst.
- **Grenzen:** Ändern zwei Personen gleichzeitig die Zeilen oder Spalten **derselben Tabelle**, kann die Tabelle danach doppelte Zellen enthalten (der Text darin läuft normal zusammen). Eine **Handschrift-Zeichnung** wird als Ganzes gespeichert: Bearbeiten zwei Personen dieselbe Zeichnung gleichzeitig, gilt eine der beiden Fassungen. **Rückgängig** macht nur deine eigenen Schritte rückgängig.
- **Löschen gewinnt:** Hat der Besitzer (oder der Admin) ein Protokoll gelöscht, bleibt es gelöscht, auch wenn ein anderes Gerät ohne Netz noch daran weitergeschrieben hat. Zurückholen geht über den Papierkorb.

## Papierkorb

Gelöschte Protokolle landen im **Papierkorb**: in der Protokollliste oben auf das Papierkorb-Symbol tippen. Dort steht, wie viele Tage ein Protokoll noch bleibt (30, der Admin kann das ändern). **Zurückholen** legt es mit dem ganzen Inhalt wieder an. Du siehst deine eigenen gelöschten Protokolle, der Admin zusätzlich die veröffentlichten der anderen. Der Papierkorb liegt auf dem Server und braucht eine Verbindung.

## Geteilte Geräte

Beim **Abmelden** wird zuerst ein letzter Abgleich versucht. Danach werden Protokolle, Aufgaben, Mitglieder, Dienste, Kleidergrößen, Wettkampf-Läufe und Vorlagen vom Gerät **gelöscht**. Die Daten liegen weiter auf dem Server und kommen bei der nächsten Anmeldung zurück. Meldet sich jemand anderes an, bekommt er nie Daten des Vorgängers zu sehen und lädt nichts unter falschem Namen hoch.

Hat ein Gerät noch nicht gesendete Änderungen (kein Netz), warnt die App vor dem Abmelden.

Nicht gelöscht werden die Einstellungen sowie die laufende Stoppuhr, die aktuelle Aufstellung und Wertung dieses Geräts.

## Geräte verwalten

Jeder Betreuer sieht unter *Einstellungen → Konto → Meine Geräte* seine Anmeldungen und kann einzelne oder alle anderen abmelden (z. B. bei einem verlorenen Handy). Der Admin sieht in der Oberfläche alle Geräte aller Benutzer. Anmeldungen laufen nach 90 Tagen ohne Nutzung ab (einstellbar).

---

**Mehr dazu:** [Datenschutz](datenschutz.md) · [Erste Schritte](erste-schritte.md)
