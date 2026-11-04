# E-Mail

[← Dokumentation](README.md)

JF Hub kann optional dein **Postfach** einbinden (zum Beispiel GMX, WEB.DE, Posteo, Gmail mit App-Passwort oder jedes andere mit IMAP): Mails lesen und schreiben, Anhänge ins Protokoll übernehmen, Protokolle als PDF verschicken, aus Mails Aufgaben machen und bei neuen Mails benachrichtigt werden. Ohne eingerichtetes Postfach ändert sich nichts.

**Auf dieser Seite:** [Einrichten](#postfach-einrichten) · [Benutzen](#was-du-damit-machen-kannst) · [Benachrichtigungen](#benachrichtigung-bei-neuen-mails) · [Datenschutz](#datenschutz-und-sicherheit) · [Für Admins](#für-admins) · [Grenzen](#grenzen)

## Postfach einrichten

1. Beim Anbieter den Zugriff per IMAP erlauben (siehe Tabelle).
2. In JF Hub: *Mehr → E-Mail* (oder *Einstellungen → E-Mail-Postfach*), Adresse und Passwort eintragen. Für die üblichen Anbieter erkennt JF Hub die Server an der Adresse, sonst wählst du „Anderer Anbieter“ und trägst IMAP- und SMTP-Server selbst ein.
3. **Verbinden.** Der Server prüft die Zugangsdaten sofort beim Mail-Server und speichert sie nur, wenn sie stimmen.

| Anbieter | Vorher nötig |
| --- | --- |
| **GMX**, **WEB.DE** | In den Einstellungen unter *POP3/IMAP-Abruf* „POP3 und IMAP Zugriff“ erlauben. Mit Zwei-Faktor-Anmeldung ein **Anwendungspasswort** erzeugen und das statt des normalen Passworts nehmen. |
| **Posteo**, **IONOS** | normales Passwort |
| **mailbox.org** | bei Zwei-Faktor ein App-Passwort |
| **T-Online** | ein eigenes „E-Mail-Passwort“ im Kundencenter |
| **Gmail** | ein App-Passwort (Google-Konto → Sicherheit → Bestätigung in zwei Schritten → App-Passwörter) |
| **Outlook.com / Microsoft 365** | Microsoft hat die Anmeldung mit Passwort für viele Konten abgeschaltet. Gehen Anmeldungen nicht, ist das nicht JF Hub; nimm dann ein anderes Postfach. (Anmeldung per OAuth gibt es noch nicht, siehe [Grenzen](#grenzen).) |

Jeder Betreuer verbindet **sein eigenes** Postfach. Das Postfach eines Betreuers sehen die anderen nicht.

## Was du damit machen kannst

- **Lesen:** Ordner wählen, suchen (Betreff, Absender), ältere Mails nachladen, als ungelesen markieren, löschen (kommt in den Papierkorb deines Postfachs).
- **Schreiben, antworten, weiterleiten:** Antworten zitieren die Mail, „Allen“ nimmt die anderen Empfänger mit (nie dich selbst), beim Weiterleiten gehen die Anhänge auf Wunsch mit. Die Mail landet auch im Ordner „Gesendet“ deines Postfachs.
- **Protokoll als PDF verschicken:** Im Protokoll auf das Umschlag-Symbol tippen. Betreff und Text sind vorbereitet, das PDF im Layout deines Vereins hängt schon an. Du kannst auch beim Schreiben „Protokoll als PDF“ wählen (bis zu 5 Protokolle). Du kannst nur Protokolle anhängen, die du auch sehen darfst.
- **Anhang weiterverarbeiten:** Am Anhang „Speichern“ oder „Ins Protokoll“. Bilder werden wie Fotos verkleinert eingefügt, alles andere als Datei (bis 10 MB). Ziel ist ein vorhandenes Protokoll (die Anhänge kommen ans Ende) oder ein neues.
- **Protokoll aus Mail:** In der Mail auf „Protokoll“: Betreff als Titel, Tag der Mail als Datum, Text und Anhänge als Inhalt.
- **Aufgabe aus Mail:** In der Mail auf „Aufgabe“: Betreff als Titel, Absender, Datum und Anfang des Textes als Beschreibung, auf Wunsch mit Fälligkeit.

## Benachrichtigung bei neuen Mails

In den Postfach-Einstellungen ist „Bei neuen Mails benachrichtigen“ standardmäßig an. Es funktioniert so:

- Der Server schaut **etwa alle 2 Minuten** in deinen Posteingang (nur wenn mindestens ein Gerät von dir für Benachrichtigungen angemeldet ist, siehe [Erste Schritte](erste-schritte.md)). Das ist keine Sofort-Zustellung.
- Die erste Prüfung meldet nichts. Du wirst nicht mit deinen ungelesenen Mails überschüttet, sondern nur mit dem, was danach neu eintrifft. Mehr als drei neue Mails auf einmal werden zusammengefasst.
- **Absender und Betreff stehen in der Benachrichtigung** (und damit auf dem Sperrbildschirm). Wer das nicht möchte, schaltet sie aus.
- Das geht über die Browser-App (PWA, auch installiert). Die Android-App zeigt keine Mail-Benachrichtigungen.

Meldet der Mail-Server Fehler (zum Beispiel nach einer Passwortänderung), steht das im Posteingang, und die Prüfung läuft nur noch stündlich, bis es wieder klappt.

## Datenschutz und Sicherheit

- **Das Passwort** liegt verschlüsselt (AES-256-GCM) in der Datenbank des Servers. Der Schlüssel steht **nicht** in der Datenbank und damit auch in keinem Backup, sondern in der Datei `mail.key` im Datenordner oder in `MAIL_KEY`. Die App bekommt das Passwort nie zurück.
- **Mails werden nicht gespeichert.** JF Hub liest sie bei Bedarf vom Mail-Server und zeigt sie nur mit Verbindung zum Server. In der Datenbank liegen nur die Zugangsdaten und der Stand der Benachrichtigung (höchste gesehene Mail-Nummer).
- **HTML-Mails erscheinen als Text.** Es wird nichts aus dem Netz nachgeladen (keine Tracking-Bilder), es laufen keine Skripte, und Links zeigen ihre Adresse. Anhänge werden nie im Browser geöffnet, sondern nur heruntergeladen.
- **Verschlüsselte Verbindung** zum Mail-Server ist Pflicht (TLS, bei Port 143 und 587 wird STARTTLS erzwungen). Das Zertifikat wird geprüft.
- **Schutz vor Missbrauch:** Der Server verbindet sich nur mit den üblichen Mail-Ports (IMAP 143/993, SMTP 25/465/587/2525) und nur mit öffentlichen Adressen. So lässt sich das interne Netz des Servers nicht über das Formular abtasten.
- **Der Betreiber des Servers** hat technisch Zugriff auf Datenbank und Schlüssel und könnte die Zugangsdaten entschlüsseln. Verbinde nur ein Postfach, das du dem Betreiber (in der Regel dein Verein) anvertraust, am besten ein eigenes Vereinspostfach statt deines privaten.
- **Der Mail-Anbieter** sieht, dass sich ein Server von dir aus anmeldet. Das ist ein weiterer Ort, an dem die Daten fließen; nimm das in deine Datenschutzinformation auf (siehe [Datenschutz](datenschutz.md)).

## Für Admins

Alles ist optional und hat sinnvolle Standardwerte (Variablen in der `.env`, siehe [Installation](installation.md#einstellungen)):

| Variable | Bedeutung | Standard |
| --- | --- | --- |
| `MAIL_ENABLED` | `0` schaltet E-Mail auf dem ganzen Server ab (die App zeigt dann einen Hinweis) | `1` |
| `MAIL_KEY` | Schlüssel für die gespeicherten Passwörter: 64 Hex-Zeichen, erzeugt mit `openssl rand -hex 32`. Leer = der Server legt beim ersten Start `/data/mail.key` an | leer |
| `MAIL_ALLOW_PRIVATE` | `1` erlaubt Mail-Server in privaten Netzen (zum Beispiel ein eigener Server im Heimnetz). Sonst werden interne Adressen abgelehnt | `0` |
| `MAIL_POLL_SECONDS` | Abstand der Prüfung auf neue Mails (mindestens 30) | `120` |

**Den Schlüssel sichern.** Die Backups enthalten bewusst nur die verschlüsselten Passwörter. Geht `mail.key` verloren (neues Volume, falsches `MAIL_KEY`), melden die Postfächer „Das Passwort lässt sich nicht entschlüsseln“, und jeder Betreuer verbindet seins neu. Sonst passiert nichts. Wer ein Backup samt Schlüssel zusammen ablegt, hebt den Schutz wieder auf.

**Demo:** In der öffentlichen [Demo](demo.md) ist E-Mail gesperrt (fremde Zugangsdaten gehören nicht auf einen Server, der täglich zurückgesetzt wird).

## Grenzen

- **Keine Sofort-Zustellung:** Benachrichtigungen kommen mit bis zu etwa 2 Minuten Verzögerung (Abfrage statt dauerhafter Verbindung je Betreuer).
- **Nur mit Verbindung:** Mails und Entwürfe werden nicht auf dem Gerät gespeichert. Ohne Netz zum Server gibt es keine Mails.
- **Nur Anmeldung mit Passwort:** Postfächer, die nur OAuth erlauben (viele Microsoft-, teils Google-Konten), gehen noch nicht.
- **Ein Postfach je Betreuer**, keine Signatur, kein Adressbuch, keine Entwürfe, keine Bcc-Zeile, kein HTML beim Schreiben (reiner Text).
- **Nicht gegen einen echten Anbieter getestet:** Die IMAP-Anbindung nutzt die Bibliothek `imapflow` und ist gegen eine Attrappe geprüft, der Versand gegen einen echten Testserver. Gegen GMX & Co. hat das noch niemand ausprobiert; bitte ein Issue melden, wenn etwas nicht klappt (ohne Passwörter und Mailinhalte).
