// Beispiel-Kleidertabelle als PDF erzeugen (zum Prüfen des Layouts).
// Aufruf: npx tsx scripts/sample-clothing-pdf.ts <Ausgabedatei.pdf>
import { writeFileSync } from 'node:fs';
import { renderClothingPdf, type ClothingPdfRequest } from '../src/clothingPdf.js';

const items = ['Kombi-Jacke', 'Kombi-Hose', 'Regenjacke', 'Handschuhe'];
const row = (name: string, current: string[], wanted: string[] = ['', '', '', ''], fresh: boolean[] = [false, false, false, false]) => ({ name, current, wanted, fresh });

const sample: ClothingPdfRequest = {
  date: '2026-10-04',
  items,
  groups: [
    {
      label: 'Jugendliche',
      rows: [
        row('Anna Beispiel', ['164', '158', 'XXS', ''], ['170', '', '', ''], [true, false, false, false]),
        row('Ben Beispiel', ['164', '170', '164', '8'], ['170', '', '', ''], [false, false, false, false]),
        row('Clara Beispiel', ['52', '52', 'S', ''], ['56', '', 'M', ''], [false, false, false, false]),
        row('David Beispiel', ['164', '164', '', '4'], ['', '', '164', ''], [false, false, false, false]),
        row('Emma Beispiel', ['50', '176', 'M', '']),
        row('Emil Alexander Beispiel', ['50', '50', 'S', '']),
        row('Finn Beispiel', ['56', '50', 'M', ''], ['58', '52', 'L', ''], [false, false, false, false]),
        row('Greta Beispiel', ['176', '170', '165 / XS', '']),
        row('Hannes Beispiel', ['158', '176', 'XS', '']),
      ],
    },
    { label: 'Betreuer', rows: [row('Max Mustermann', ['54', '52', 'L', '9'])] },
  ],
  totals: [
    { item: 'Kombi-Jacke', sizes: [{ size: '170', count: 2 }, { size: '56', count: 1 }, { size: '58', count: 1 }] },
    { item: 'Kombi-Hose', sizes: [{ size: '52', count: 1 }] },
    { item: 'Regenjacke', sizes: [{ size: '164', count: 1 }, { size: 'M', count: 1 }, { size: 'L', count: 1 }] },
  ],
};

const out = process.argv[2] ?? 'Kleidertabelle-Beispiel.pdf';
writeFileSync(out, await renderClothingPdf(sample, { orgName: 'Jugendfeuerwehr', footer: 'Jugendfeuerwehr – Kleiderliste', accent: '#c0392b', logo: '' }));
console.log(out);
