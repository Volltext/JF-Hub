# Umstieg von der privaten Vorversion (1.x)

[← Dokumentation](README.md)

Diese Seite ist für alle, die den Vorgänger **JF Hub Server 1.x** (ein gemeinsames Passwort, „Protokoll-Server“) schon betreiben.

> [!WARNING]
> **Mach vorher ein Backup** (*Admin → Backup & Export*). Ein Zurück auf 1.x ist nach der Migration nicht vorgesehen (das alte Passwort-Feld wird entfernt).

## 1. Server aktualisieren

Neues Image starten (gleiches Volume `/data`, siehe [Aktualisieren](installation.md#aktualisieren)). Beim ersten Start migriert der Server die Datenbank automatisch:

| Vorher | Danach |
| --- | --- |
| Ein gemeinsames Passwort | Admin-Konto **`admin`** mit demselben Passwort (Anzeigename „Admin“) |
| Angemeldete Geräte | bleiben angemeldet, gehören dem Konto `admin` |
| Protokolle | gehören `admin`, **veröffentlicht** (für alle sichtbar) |
| Mitglieder, Dienste, Kleidung | für alle sichtbar |
| Aufgaben | gehören `admin`, **privat** |

## 2. Betreuer einladen

In der Admin-Oberfläche unter *Benutzer* die anderen Betreuer einladen ([so geht's](benutzer-und-sichtbarkeit.md#betreuer-einladen)). Den Admin kannst du umbenennen, oder du legst ein eigenes Admin-Konto an und löschst das Konto `admin` (veröffentlichte Daten gehen dann an dich).

## 3. Handy und Laptop

| Gerät | Was zu tun ist |
| --- | --- |
| **Android-App** | Neue APK installieren (Version 2.x). Eine bestehende Anmeldung bleibt bestehen (sie gehört nach der Migration dem Konto `admin`). Daten, Protokolle und Aufgaben sind sofort wieder da. Neue Anmeldungen gehen mit Benutzername und Passwort: *Einstellungen → Server & Konto*. Die lokale Datenbank passt die App selbst an; das Dienstbuch (Feuer-On-Anbindung) ist entfernt. |
| **Laptop/Tablet im Browser** | Adresse neu laden, mit Benutzername und Passwort anmelden. Der Browser installiert sich beim nächsten Besuch als PWA. |

> [!IMPORTANT]
> **Bei der APK:** Wer die APK bisher selbst signiert hat, muss **denselben Schlüssel** weiter verwenden, sonst lässt sie sich nicht über die alte App installieren.

## Daten aus den alten Apps (JF-Planer, Coach-App)

Der Import-Weg ist entfallen. Wer ihn noch braucht, importiert zuerst mit der alten App-Version und sichert danach. Die Sicherungsdatei (JSON) lässt sich in 2.x unter *Einstellungen → Daten & Backup → Sicherung wiederherstellen* einspielen, solange sie von JF Hub stammt.

---

**Als Nächstes:** [Erste Schritte](erste-schritte.md)
