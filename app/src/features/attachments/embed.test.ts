import { describe, expect, it } from 'vitest';
import { embedKind, pageCaption } from './embed';

describe('embedKind', () => {
  it('erkennt PDFs und Bilder an Typ oder Endung', () => {
    expect(embedKind('application/pdf', 'Einladung.pdf')).toBe('pdf');
    expect(embedKind('', 'Einladung.PDF')).toBe('pdf');
    expect(embedKind('application/octet-stream', 'scan.pdf')).toBe('pdf');
    expect(embedKind('image/png', 'plan.png')).toBe('image');
    expect(embedKind('', 'foto.JPG')).toBe('image');
  });

  it('lässt alles andere Anhang bleiben', () => {
    expect(embedKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Brief.docx')).toBeNull();
    expect(embedKind('image/svg+xml', 'logo.svg')).toBeNull(); // SVG kann Skripte enthalten und wird nicht umgerechnet
    expect(embedKind('image/heic', 'IMG_1.heic')).toBeNull();
    expect(embedKind('text/plain', 'notiz.txt')).toBeNull();
  });
});

describe('pageCaption', () => {
  it('nennt Datei und Seite, bei einer Seite nur die Datei', () => {
    expect(pageCaption('Einladung.pdf', 2, 5)).toBe('Einladung.pdf · Seite 2 von 5');
    expect(pageCaption('Einladung.pdf', 1, 1)).toBe('Einladung.pdf');
    expect(pageCaption('', 1, 2)).toBe('PDF · Seite 1 von 2');
  });
});
