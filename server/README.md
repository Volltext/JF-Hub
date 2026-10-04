# JF Hub – Server

Node 22, Fastify, SQLite (`node:sqlite`), PDF-Erzeugung, Web-Push und die Admin-Oberfläche (`public/admin`). Gesamtübersicht und Installation: [../README.md](../README.md), Entwicklung und API: [../docs/entwicklung.md](../docs/entwicklung.md).

```bash
npm install
npm run dev        # http://localhost:8080 (Daten in ./data; Setup-Code steht im Terminal)
npm test
npm run build && npm start
```

Beispiel-PDF der Kleidertabelle zum Prüfen des Layouts: `npx tsx scripts/sample-clothing-pdf.ts beispiel.pdf`
