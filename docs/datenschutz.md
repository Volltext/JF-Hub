# Datenschutz

> Das ist eine praktische Orientierung, **keine Rechtsberatung**. Wer JF Hub für eine Jugendfeuerwehr betreibt, ist für die Daten verantwortlich. Sprecht das mit dem Wehrführer, der Gemeinde bzw. dem Träger und ggf. dem Datenschutzbeauftragten ab.

## Welche Daten speichert JF Hub?

| Daten | Wo | Anmerkung |
| --- | --- | --- |
| Konten der Betreuer: Benutzername, Anzeigename, Passwort-Hash (scrypt), letzte Anmeldung | Server | Keine E-Mail-Adresse, keine Telefonnummer |
| Geräte-Anmeldungen: Gerätebezeichnung, Zeitpunkte, Hash des Tokens | Server | einzeln widerrufbar |
| Mitglieder: **Name**, Jugendlicher/Betreuer, aktiv | Server + Geräte | **keine** Geburtsdaten, Adressen, Kontakte |
| Dienste: Datum, wer anwesend/abwesend war | Server + Geräte | |
| Kleidergrößen und Bestellwünsche je Mitglied | Server + Geräte | |
| Protokolle (Text, Fotos, Anhänge, Handschrift), Aufgaben | Server + Geräte | Inhalt bestimmen die Betreuer – denkt an Fotos von Kindern |
| Push-Abonnements: technische Adresse des Push-Dienstes deines Browsers, geplante Erinnerungen | Server | werden beim Abmelden gelöscht |
| Wettkampf-Läufe (mit Namen der aufgestellten Mitglieder) und Aufstellungs-Vorlagen | Server + Geräte | für alle Betreuer sichtbar |
| Laufende Stoppuhr, aktuelle Aufstellung | nur Gerät | Arbeitsstand, wird nicht an den Server gesendet |

Es gibt **keine Analyse-Werkzeuge, keine Werbung und keine Weitergabe** an Dritte durch JF Hub selbst.

## Wohin gehen Daten nach außen?

- **Schulferien:** Der Server fragt öffentliche Ferientermine bei `openholidaysapi.org` ab (nur das Bundesland, keine personenbezogenen Daten) und gibt sie an die Geräte weiter. Die Android-App fragt diesen Dienst direkt ab (dabei sieht er die IP-Adresse des Handys), wenn sie ohne Server benutzt wird.
- **Push-Benachrichtigungen:** Für Web-Push nutzen Browser den Dienst ihres Herstellers (Google, Mozilla, Apple, Microsoft). Dorthin gehen nur die Nachricht und die technische Adresse des Geräts. Die Nachrichtentexte („Dienst gleich“, Titel fälliger Aufgaben) sind Ende-zu-Ende verschlüsselt, sodass der Push-Dienst sie nicht lesen kann.
- **Handschrift → Text (Android):** Die Texterkennung lädt beim ersten Mal ein Sprachmodell von Google herunter; die Erkennung selbst läuft auf dem Gerät.
- **Cloudflare Tunnel:** Cloudflare leitet den Datenverkehr weiter und beendet dabei die Verschlüsselung. Cloudflare kann den Verkehr technisch einsehen (siehe [Cloudflare Tunnel](cloudflare-tunnel.md)). Wer das nicht möchte, nimmt Tailscale oder einen eigenen Reverse-Proxy ([Alternativen](https-alternativen.md)). Mit Cloudflare ist ein Vertrag zur Auftragsverarbeitung nötig (Cloudflare bietet ihn an).

## Empfehlungen

- **Hosting:** Am besten zu Hause/im Gerätehaus oder bei einem Anbieter in der EU. Der Server braucht kaum Leistung.
- **Zugriff:** Nur Betreuer bekommen Konten; Konten ausgeschiedener Betreuer **sperren oder löschen**.
- **Einwilligungen:** Für Fotos von Jugendlichen gelten die üblichen Regeln (Einwilligung der Eltern). Fotos in Protokollen sind für alle sichtbar, sobald das Protokoll veröffentlicht ist.
- **Backups:** Das Backup enthält die vollständigen Daten. Verschlüsselt und nicht in einer fremden Cloud ablegen. Der Server legt täglich automatische Backups in `/data/backups` an; gelöschte Mitglieder oder Protokolle stecken dort noch bis zu 7 Tage (einstellbar) weiter drin, bis das Backup durch ein neueres ersetzt wird.
- **Geräte:** PIN-Sperre der Android-App einschalten, Bildschirmsperre am Handy nutzen. Auf geteilten Geräten immer abmelden (das löscht die lokalen Daten).
- **Löschen:** Mitglieder löschen entfernt auch ihre Kleidergrößen. Frühere Dienste behalten eine Referenz auf die ID (ohne Namen); die Statistik ignoriert sie. Protokolle landen zuerst im Papierkorb (30 Tage, einstellbar) und werden dann endgültig gelöscht. Endgültiges Löschen gibt es auch sofort: Admin → Protokolle → Papierkorb.
- **Auskunft/Export:** Admin → Backup & Export liefert alle Protokolle als PDF + JSON. Daten einzelner Personen stehen in der Datenbank (SQLite) und lassen sich auslesen.

## Technischer Schutz

- Passwörter: scrypt, mindestens 10 Zeichen, begrenzte Anmeldeversuche je Adresse und je Konto.
- Sitzungen: zufällige Tokens (nur der Hash liegt auf dem Server), im Browser in einem `HttpOnly`-Cookie (`SameSite=Strict`, bei https `Secure`) mit Schutz gegen CSRF.
- Strenge Sicherheits-Header (CSP, HSTS, `X-Frame-Options`), keine Inhalte von Fremdservern.
- Der Container läuft ohne Root-Rechte und mit `no-new-privileges`.
- Daten auf dem Server sind **nicht zusätzlich verschlüsselt** (außer durch die Verschlüsselung deines Datenträgers). Aktiviere sie dort (z. B. BitLocker, LUKS), wenn der Rechner nicht abgeschlossen steht.
