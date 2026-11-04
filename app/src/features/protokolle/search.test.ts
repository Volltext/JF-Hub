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

describe('extractText: Tabellen, Links, Markierungen', () => {
  const p = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  const cell = (t: string, type = 'tableCell') => ({ type, content: [p(t)] });
  const row = (...cells: object[]) => ({ type: 'tableRow', content: cells });

  it('eine Zeile je Tabellenzeile, die Zellen mit „ · “ getrennt', () => {
    const d = {
      type: 'doc',
      content: [{ type: 'table', content: [row(cell('Name', 'tableHeader'), cell('Gruppe', 'tableHeader')), row(cell('Anna'), cell('Gruppe 1'))] }, p('Danach')],
    };
    expect(extractText(d)).toBe('Name · Gruppe\nAnna · Gruppe 1\nDanach');
  });

  it('mehrere Absätze oder Listenpunkte in einer Zelle bleiben in derselben Zeile', () => {
    const multi = { type: 'tableCell', content: [p('Schläuche'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('B-Rohr')] }] }] };
    const d = { type: 'doc', content: [{ type: 'table', content: [row(cell('Material'), multi)] }] };
    expect(extractText(d)).toBe('Material · Schläuche B-Rohr');
  });

  it('leere Zellen und leere Zeilen erzeugen keine Lücken', () => {
    const d = { type: 'doc', content: [{ type: 'table', content: [row(cell('a'), cell(''), cell('c')), row(cell(''), cell('')), row(cell('d'))] }] };
    expect(extractText(d)).toBe('a · c\nd');
  });

  it('Link- und Markierungstext zählt als gewöhnlicher Text', () => {
    const d = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Mehr unter ' },
            { type: 'text', text: 'example.de', marks: [{ type: 'link', attrs: { href: 'https://example.de' } }] },
            { type: 'text', text: ' wichtig', marks: [{ type: 'highlight', attrs: { color: null } }] },
          ],
        },
      ],
    };
    expect(extractText(d)).toBe('Mehr unter example.de wichtig');
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
