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
| Handschrift | einfacher Editor | **Stiftdruck, niedrige Latenz, Handballen-Erkennung, Handschrift → Text** |
| Bildschirm wach halten (Stoppuhr) | ✓ (wenn der Browser es kann) | ✓ |
| PIN-Sperre | – | ✓ |
| Updates | automatisch | neue APK installieren |
| Ohne Server nutzbar | – (Anmeldung nötig) | ✓ (lokal, ohne Abgleich) |

> [!TIP]
> Im Zweifel: Starte mit der PWA. Die Android-App kannst du jederzeit zusätzlich installieren, die Daten liegen ja auf dem Server.

## APK installieren

1. Unter [Releases](https://github.com/Volltext/JF-Hub/releases) die neueste `JF-Hub-<Version>-release.apk` laden.
2. Datei öffnen. Android fragt einmalig nach „Installation aus unbekannten Quellen“ für den Browser bzw. Dateimanager.
3. App öffnen → *Einstellungen → Server & Konto*: Adresse des Servers (`jfhub.deine-domain.de`), Benutzername und Passwort eintragen – oder **Einladung einlösen**.

Die App ist **nicht** im Play Store.

### Updates

Neue APK einfach drüberinstallieren. Das klappt nur, wenn sie mit **demselben Schlüssel** signiert ist. Releases dieses Projekts sind immer mit dem Schlüssel des Projekts signiert. Selbst gebaute APKs tragen deine eigene Signatur und lassen sich nicht über die Release-APK installieren (und umgekehrt). Dann vorher die Daten sichern bzw. neu anmelden (sie liegen auf dem Server).

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

Der Workflow `.github/workflows/android.yml` baut die APK bei jedem Tag `v*` und hängt sie ans Release. Für signierte Release-APKs legst du vier Repository-Secrets an (Anleitung im Kopf der Workflow-Datei). Ohne Secrets entsteht eine Debug-APK.

</details>

## Die Android-Teile im Code

- `app/android/app/src/main/java/de/jfhub/app/` – Handschrift: `InkEditorActivity`, `InkCanvas`, `InkPageView`, `InkRecognizer` (androidx.ink 1.0.0, ML Kit Digital Ink), die Plugin-Brücke `InkEditorPlugin` und `MainActivity`.
- Alles andere (Oberfläche, Datenbank, Abgleich) ist derselbe TypeScript-Code wie in der PWA. Capacitor-Plugins ersetzen Browser-Funktionen (Benachrichtigungen, Teilen, Dateien, Haptik).
- Neue Plugins in Java müssen **vor** `super.onCreate` in `MainActivity` registriert werden.

---

**Mehr dazu:** [Benutzer und Sichtbarkeit](benutzer-und-sichtbarkeit.md) · [Datenschutz](datenschutz.md)
