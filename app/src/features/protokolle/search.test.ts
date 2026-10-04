import { describe, expect, it } from 'vitest';
import { extractText, fold, searchProtocols, type SearchItem } from './search';

const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Begrüßung' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Der ' }, { type: 'text', text: 'Übungsplan', marks: [{ type: 'bold' }] }, { type: 'text', text: ' wurde besprochen.' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Schläuche prüfen' }] }] }] },
  ],
};

const item = (id: string, title: string, text: string): SearchItem => ({ id, title, ort: '', leitung: '', text });

describe('extractText', () => {
  it('liest Text über Formatierungen und Listen hinweg', () => {
    expect(extractText(doc)).toBe('Begrüßung\nDer Übungsplan wurde besprochen.\nSchläuche prüfen');
  });
});

describe('fold', () => {
  it('ignoriert Groß-/Kleinschreibung und Umlaute, ohne die Länge zu ändern', () => {
    expect(fold('ÜBUNG Schläuche')).toBe('ubung schlauche');
    expect(fold('Straße').length).toBe(6);
  });
});

describe('searchProtocols', () => {
  const items = [item('a', 'Dienst 1', extractText(doc)), item('b', 'Wettkampf', 'Aufstellung der Gruppe'), item('c', 'Übungsdienst', 'nichts')];

  it('findet im Text ohne Rücksicht auf Umlaute und liefert einen markierten Ausschnitt', () => {
    const hits = searchProtocols(items, 'ubungsplan');
    expect(hits.map((h) => h.id)).toEqual(['a']);
    expect(hits[0]!.snippet!.parts.find((p) => p.hit)!.text).toBe('Übungsplan');
  });

  it('verlangt alle Suchwörter und sortiert Titeltreffer nach vorn', () => {
    expect(searchProtocols(items, 'gruppe aufstellung').map((h) => h.id)).toEqual(['b']);
    expect(searchProtocols(items, 'gruppe xyz')).toEqual([]);
    expect(searchProtocols(items, 'ubung').map((h) => h.id)).toEqual(['c', 'a']);
  });

  it('liefert bei leerer Suche nichts', () => {
    expect(searchProtocols(items, '  ')).toEqual([]);
  });
});
