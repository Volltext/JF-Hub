# JF Hub – App

React + TypeScript (Vite), als PWA und per Capacitor als Android-App. Gesamtübersicht und Installation: [../README.md](../README.md), Entwicklung: [../docs/entwicklung.md](../docs/entwicklung.md), Android: [../docs/android-app.md](../docs/android-app.md).

```bash
npm install
npm run dev:web     # Web-App mit Hot-Reload (Server aus ../server auf :8080 nötig)
npm run dev         # wie die Android-Hülle: lokal, ohne Anmeldung
npm test            # Tests
npm run build:web   # PWA nach dist-web (inkl. Service Worker)
npm run apk        # Android-APK (siehe docs/android-app.md)
npm run assets     # App-Symbol/Startbild neu erzeugen
```
