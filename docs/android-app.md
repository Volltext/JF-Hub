# Android-App (optional)

[← Dokumentation](README.md)

Die **App im Browser (PWA)** deckt fast alles ab. Die Android-App ist ein Zusatz für alle, die den **Stift** oder **zuverlässige Erinnerungen** wollen.

**Auf dieser Seite:** [PWA oder App?](#pwa-oder-app) · [APK installieren](#apk-installieren) · [Selbst bauen](#selbst-bauen) · [Android-Teile im Code](#die-android-teile-im-code)

## PWA oder App?

| | App im Browser (PWA) | Android-App |
| --- | :---: | :---: |
| Protokolle, Dienste, Aufgaben, Kleidung, Wettkampf | ✓ | ✓ |
| Offline-Betrieb | ✓ | ✓ |
| Installation | über den Browser, kostenlos, alle Systeme | APK, nur Android |
| Erinnerungen | Web-Push vom Server (braucht https) | lokale Alarme, auch ohne Server |
| E-Mail-Postfach ([E-Mail](e-mail.md)) | ✓ | ✓ (Benachrichtigung bei neuen Mails nur in der PWA) |
| Handschrift | einfacher Editor | **Stiftdruck, niedrige Latenz, Handballen-Erkennung, Handschrift → Text** |
| Bildschirm wach halten (Stoppuhr) | ✓ (wenn der Browser es kann) | ✓ |
| PIN-Sperre | – | ✓ |
| Updates | automatisch | neue APK installieren; die App meldet neue Versionen selbst |
| Ohne Server nutzbar | – (Anmeldung nötig) | ✓ (lokal, ohne Abgleich) |

> [!TIP]
> Im Zweifel: Starte mit der PWA. Die Android-App kannst du jederzeit zusätzlich installieren, die Daten liegen ja auf dem Server.

## APK installieren

1. In der App im Browser unter **Einstellungen › App & Version** auf „APK herunterladen“ tippen. Das ist genau die Version, die zu deinem Server passt. Alternativ unter [Releases](https://github.com/Volltext/JF-Hub/releases) die `JF-Hub-<Version>-release.apk` zur Version deines Servers laden.
2. Datei öffnen. Android fragt einmalig nach „Installation aus unbekannten Quellen“ für den Browser bzw. Dateimanager.
3. App öffnen → *Einstellungen → Server & Konto*: Adresse des Servers (`jfhub.deine-domain.de`), Benutzername und Passwort eintragen – oder **Einladung einlösen**.

Die App ist **nicht** im Play Store.

**Echtheit prüfen:** Alle Release-APKs ab 3.5.0 sind mit demselben Schlüssel signiert. Fingerabdruck des Zertifikats (SHA-256):

```
c0abf4bdd1c5649add00cf7a9b68c446d8ea74c90298367896f1132d8efe4973
```

Der APK-Workflow schreibt ihn bei jedem Release in die Zusammenfassung des Laufs; mit `apksigner verify --print-certs <apk>` prüfst du eine heruntergeladene Datei selbst.

### Umstieg von einer Debug-APK

Bis 3.4.0 entstanden ohne hinterlegten Schlüssel **Debug-APKs** (Dateiname `…-debug.apk`). Sie sind bei jedem Bau anders signiert, deshalb lässt sich die Release-APK nicht über sie installieren (Android meldet „App nicht installiert“ bzw. „Paket steht in Konflikt“). Einmalig:

1. In der alten App abgleichen (Symbol oben, bis „Abgeglichen“ dasteht). Was nicht beim Server ist, geht beim Deinstallieren verloren.
2. Die alte App deinstallieren.
3. Die Release-APK installieren und wieder anmelden (bzw. Server-Adresse eintragen). Die Daten kommen vom Server; eine PIN-Sperre musst du neu setzen.

Ab dann installiert sich jedes Update über die vorhandene App.

### Updates

Wird dein Server aktualisiert, zeigt die App auf „Heute“ den Hinweis **„Neue App-Version“** mit Download-Knopf (auch unter *Einstellungen › App & Version*). Die neue APK einfach drüberinstallieren. Das klappt nur, wenn sie mit **demselben Schlüssel** signiert ist. Releases dieses Projekts sind immer mit dem Schlüssel des Projekts signiert. Selbst gebaute APKs tragen deine eigene Signatur und lassen sich nicht über die Release-APK installieren (und umgekehrt). Dann vorher die Daten sichern bzw. neu anmelden (sie liegen auf dem Server).

> [!IMPORTANT]
> **Ab Version 3.0.0 gehört zu einem aktualisierten Server immer die neue APK.** Der Server schreibt den Text der Protokolle jetzt gemeinsam mit allen Geräten fort und lässt ältere Apps nicht mehr ran: Sie melden „Bitte die App aktualisieren“. Ihre Daten bleiben unberührt; ungesendete Änderungen aus der alten App legt die neue als Protokoll „… (lokale Fassung)“ an. Auf eine ältere APK zurückzugehen, ist nach dem Update nicht möglich: Die Datenbank der App wird nur vorwärts umgebaut.

## Selbst bauen

Voraussetzungen: Node 22, JDK 21 (z. B. das von Android Studio), Android SDK.

```bash
cd app
npm install
npm run apk -- debug     # Debug-APK, ohne eigenen Schlüssel
npm run apk              # signierte Release-APK, braucht android/keystore.properties
```

Das Ergebnis liegt in `app/apk/`. `scripts/build-apk.mjs` nutzt das JDK von Android Studio, falls `JAVA_HOME` nicht gesetzt ist.

<details>
<summary><b>Eigenen Signierschlüssel anlegen</b></summary>
<br>

```bash
keytool -genkeypair -v -keystore app/android/keystore/jf-hub.keystore \
  -alias jfhub -keyalg RSA -keysize 4096 -validity 36500
```

Lege `app/android/keystore.properties` an (steht in der `.gitignore`):

```properties
storeFile=keystore/jf-hub.keystore
storePassword=…
keyAlias=jfhub
keyPassword=…
```

> [!WARNING]
> **Sichere Keystore und Passwörter an einem zweiten Ort.** Ohne sie kannst du keine Updates mehr veröffentlichen, die über die installierte App drüberinstallieren. Checke sie nie ins Repository ein.

</details>

<details>
<summary><b>Releases per GitHub Actions</b></summary>
<br>

Der Workflow `.github/workflows/android.yml` baut die APK bei jedem Tag `v*` und hängt sie ans Release. Dafür braucht er vier Repository-Secrets (*Settings › Secrets and variables › Actions*):

| Secret | Inhalt |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | die Keystore-Datei, base64-kodiert (`base64 -w0 jf-hub.keystore`) |
| `ANDROID_KEYSTORE_PASSWORD` | Passwort des Keystores |
| `ANDROID_KEY_ALIAS` | Alias des Schlüssels (hier `jfhub`) |
| `ANDROID_KEY_PASSWORD` | Passwort des Schlüssels (bei PKCS12 dasselbe wie oben) |

Fehlen sie, **bricht ein Release ab**, statt eine Debug-APK zu veröffentlichen (die sich nicht als Update installieren ließe). Von Hand gestartet (*Actions › Android-APK › Run workflow*) entsteht ohne Secrets weiterhin eine Debug-APK zum Ausprobieren, als Artefakt des Laufs.

</details>

## Die Android-Teile im Code

- `app/android/app/src/main/java/de/jfhub/app/` – Handschrift: `InkEditorActivity`, `InkCanvas`, `InkPageView`, `InkRecognizer` (androidx.ink 1.0.0, ML Kit Digital Ink), die Plugin-Brücke `InkEditorPlugin` und `MainActivity`.
- Alles andere (Oberfläche, Datenbank, Abgleich) ist derselbe TypeScript-Code wie in der PWA. Capacitor-Plugins ersetzen Browser-Funktionen (Benachrichtigungen, Teilen, Dateien, Haptik).
- Neue Plugins in Java müssen **vor** `super.onCreate` in `MainActivity` registriert werden.

---

**Mehr dazu:** [Benutzer und Sichtbarkeit](benutzer-und-sichtbarkeit.md) · [Datenschutz](datenschutz.md)
