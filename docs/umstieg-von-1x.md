# Umstieg von der privaten Vorversion (1.x)

Dieser Abschnitt ist für alle, die den Vorgänger **JF Hub Server 1.x** (ein gemeinsames Passwort, „Protokoll-Server“) schon betreiben.

## Server

Neues Image starten (gleiches Volume `/data`). Beim ersten Start migriert der Server die Datenbank automatisch:

| Vorher | Danach |
| --- | --- |
| Ein gemeinsames Passwort | Admin-Konto **`admin`** mit demselben Passwort (Anzeigename „Admin“) |
| Angemeldete Geräte | bleiben angemeldet, gehören dem Konto `admin` |
| Protokolle | gehören `admin`, **veröffentlicht** (für alle sichtbar) |
| Mitglieder, Dienste, Kleidung | für alle sichtbar |
| Aufgaben | gehören `admin`, **privat** |

Danach in der Admin-Oberfläche unter *Benutzer* die anderen Betreuer einladen und den Admin ggf. umbenennen bzw. ein eigenes Admin-Konto anlegen und das Konto `admin` löschen (veröffentlichte Daten gehen dann an dich).

**Backup vorher** (Admin → Backup & Export). Ein Zurück auf 1.x ist nach der Migration nicht vorgesehen (das alte Passwort-Feld wird entfernt).

## Handy und Laptop

- **Android-App:** Neue APK installieren (Version 2.x). Eine bestehende Anmeldung bleibt bestehen (sie gehört nach der Migration dem Konto `admin`); Daten, Protokolle und Aufgaben sind sofort wieder da. Neue Anmeldungen gehen mit Benutzername und Passwort: *Einstellungen → Server & Konto*. Die lokale Datenbank passt die App selbst an; das Dienstbuch (Feuer-On-Anbindung) ist entfernt.
- **Laptop/Tablet im Browser:** Adresse neu laden, mit Benutzername und Passwort anmelden. Der Browser installiert sich beim nächsten Besuch als PWA.
- **Wichtig bei der APK:** Wer die APK bisher selbst signiert hat, muss **denselben Schlüssel** weiter verwenden, sonst lässt sie sich nicht über die alte App installieren.

## Daten aus den alten Apps (JF-Planer, Coach-App)

Der Import-Weg ist entfallen. Wer ihn noch braucht, importiert zuerst mit der alten App-Version und sichert danach; die Sicherungsdatei (JSON) lässt sich in 2.x unter *Einstellungen → Daten & Backup → Sicherung wiederherstellen* einspielen, solange sie von JF Hub stammt.
