import { describe, expect, it } from 'vitest';
import { noteInfo, countWords, readingMinutes } from './preview';
import { extractTags, stripTags, tagMatches } from './tags';

describe('extractTags', () => {
  it('findet Tags mit Umlauten und Unterthemen', () => {
    expect(extractTags('Heute #Dienstabend mit #Übung und #2026/Lager')).toEqual(['Dienstabend', 'Übung', '2026/Lager']);
  });
  it('erkennt weder Nummern noch Überschriften noch Mitten im Wort', () => {
    expect(extractTags('Punkt #3 und # Titel und a#b und C#')).toEqual([]);
  });
  it('findet Tags nach Klammer und am Zeilenanfang', () => {
    expect(extractTags('(#Knoten)\n#Wettkampf')).toEqual(['Knoten', 'Wettkampf']);
  });
  it('führt Doppelte zusammen, egal ob groß oder klein', () => {
    expect(extractTags('#Dienst #dienst #DIENST')).toEqual(['Dienst']);
  });
  it('schneidet abschließende Trenner ab', () => {
    expect(extractTags('#Lager- und #Zelt/')).toEqual(['Lager', 'Zelt']);
  });
  it('lässt Doppel-Raute und Links in Ruhe', () => {
    expect(extractTags('##x und https://a.de/#anker')).toEqual([]);
  });
});

describe('tagMatches', () => {
  it('trifft Gleiches und Unterthemen, nicht ähnliche Namen', () => {
    expect(tagMatches('Dienst', 'dienst')).toBe(true);
    expect(tagMatches('Dienst/Knoten', 'Dienst')).toBe(true);
    expect(tagMatches('Dienstplan', 'Dienst')).toBe(false);
  });
});

describe('stripTags / noteInfo', () => {
  it('entfernt Tags aus der Vorschau', () => {
    expect(stripTags('Aufbau #Lager erledigt')).toBe('Aufbau erledigt');
  });
  it('baut Vorschau, Tags und Wortzahl', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '#Lager Zelte aufgebaut' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Alle waren da.' }] }] };
    const info = noteInfo(doc);
    expect(info.preview).toBe('Zelte aufgebaut · Alle waren da.');
    expect(info.tags).toEqual(['Lager']);
    expect(info.words).toBe(6);
  });
  it('kürzt lange Vorschauen', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'wort '.repeat(100) }] }] };
    expect(noteInfo(doc, 20).preview.endsWith('…')).toBe(true);
  });
  it('zählt Wörter und Lesezeit', () => {
    expect(countWords("Das ist's – 3 Wörter-Test")).toBe(4);
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(10)).toBe(1);
    expect(readingMinutes(600)).toBe(3);
  });
});
