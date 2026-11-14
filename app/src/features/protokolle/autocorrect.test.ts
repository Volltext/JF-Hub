import { describe, expect, it } from 'vitest';
import { autocorrect, isSentenceStart, TYPOS } from './autocorrect';

/** Tippt `text` Zeichen für Zeichen und wendet jede Korrektur an, wie der Editor es tut. */
function type(text: string, start = ''): string {
  let doc = start;
  for (const ch of text) {
    if (ch === '\n') {
      const fix = autocorrect(doc, true);
      if (fix) doc = doc.slice(0, doc.length - fix.length) + fix.text;
      doc += '\n';
      continue;
    }
    // Wie im Editor: Geprüft wird nur der aktuelle Absatz.
    const line = doc.slice(doc.lastIndexOf('\n') + 1) + ch;
    const fix = autocorrect(line);
    doc += ch;
    if (fix) doc = doc.slice(0, doc.length - fix.length) + fix.text;
  }
  return doc;
}

describe('autocorrect: Satzanfang', () => {
  it('schreibt den ersten Buchstaben eines Satzes groß', () => {
    expect(type('heute waren alle da. danach gab es pizza! wer kam? niemand ')).toBe('Heute waren alle da. Danach gab es pizza! Wer kam? Niemand ');
  });

  it('nicht nach Abkürzungen, Ordnungszahlen und einzelnen Buchstaben', () => {
    expect(type('Wir üben z. B. den Knoten. ')).toBe('Wir üben z. B. den Knoten. ');
    expect(type('Wir üben z.B. den Knoten. ')).toBe('Wir üben z.B. den Knoten. ');
    expect(type('Es kamen ca. zwanzig, bzw. fast alle. ')).toBe('Es kamen ca. zwanzig, bzw. fast alle. ');
    expect(type('Am 3. november geht es los. ')).toBe('Am 3. november geht es los. ');
    expect(type('Siehe Nr. drei. ')).toBe('Siehe Nr. drei. ');
  });

  it('nach Wörtern, die auch am Satzende stehen', () => {
    expect(type('Das war so. danach ')).toBe('Das war so. Danach ');
    expect(type('Das macht Max. dann ')).toBe('Das macht Max. Dann ');
  });

  it('am Zeilenanfang und nach öffnenden Anführungszeichen', () => {
    expect(type('erste Zeile\nzweite Zeile')).toBe('Erste Zeile\nZweite Zeile');
    expect(type('Er sagte: "gut. danke"')).toBe('Er sagte: „gut. Danke“');
  });

  it('lässt Adressen, #Tags und Wörter mit Großbuchstaben in Ruhe', () => {
    expect(type('Siehe www.beispiel.de. ')).toBe('Siehe www.beispiel.de. ');
    expect(type('#ausbildung heute ')).toBe('#ausbildung heute ');
    expect(type('iPad gekauft ')).toBe('iPad gekauft ');
    expect(isSentenceStart('Wir lesen www.')).toBe(false);
  });
});

describe('autocorrect: Tippfehler', () => {
  it('korrigiert häufige Tippfehler und hält die Großschreibung', () => {
    expect(type('Kinder udn Betreuer, nciht alle. ')).toBe('Kinder und Betreuer, nicht alle. ');
    expect(type('Das ist vieleicht gut. udn dann ')).toBe('Das ist vielleicht gut. Und dann ');
    expect(type('Im Standart steht ')).toBe('Im Standard steht ');
    expect(type('Wir haben einen standart ')).toBe('Wir haben einen Standard ');
  });

  it('korrigiert erst, wenn das Wort zu Ende ist, auch am Zeilenende', () => {
    expect(type('udn')).toBe('udn');
    expect(type('Ich udn')).toBe('Ich udn');
    expect(type('Ich udn\n')).toBe('Ich und\n');
    expect(type('Ich udn.')).toBe('Ich und.');
  });

  it('lässt Wörter in Großbuchstaben und mitten im Wort stehen', () => {
    expect(type('Nur UDN ')).toBe('Nur UDN ');
    expect(type('Das Kidnerfest ')).toBe('Das Kidnerfest ');
    expect(type('E-udn ')).toBe('E-udn ');
  });

  it('enthält nur Fehler, die selbst keine gängigen Wörter sind', () => {
    for (const ok of ['die', 'das', 'sei', 'nur', 'ist', 'so', 'art', 'max', 'order', 'seit', 'seid', 'wider']) expect(TYPOS[ok]).toBeUndefined();
    for (const [k, v] of Object.entries(TYPOS)) {
      expect(k).toBe(k.toLocaleLowerCase('de-DE'));
      expect(v.toLocaleLowerCase('de-DE')).not.toBe(k);
    }
  });
});

describe('autocorrect: zwei Großbuchstaben', () => {
  it('korrigiert ZWei Großbuchstaben am Wortanfang', () => {
    expect(type('Der DIenst war gut ')).toBe('Der Dienst war gut ');
  });

  it('lässt Abkürzungen und Wörter in Großbuchstaben stehen', () => {
    expect(type('Alle JFler und PCs, THW und LKWs ')).toBe('Alle JFler und PCs, THW und LKWs ');
  });
});

describe('autocorrect: Typografie', () => {
  it('setzt deutsche Anführungszeichen', () => {
    expect(type('Er sagte "Wasser marsch" und ging. ')).toBe('Er sagte „Wasser marsch“ und ging. ');
    expect(type('"Hallo"')).toBe('„Hallo“');
    expect(type('Titel ("Neu")')).toBe('Titel („Neu“)');
  });

  it('macht aus " - " zwischen Wörtern einen Gedankenstrich', () => {
    expect(type('Punkt 1 - Begrüßung')).toBe('Punkt 1 – Begrüßung');
    expect(type('Punkt 1 -- Begrüßung')).toBe('Punkt 1 – Begrüßung');
  });

  it('lässt Bindestriche, Aufzählungen und Trennlinien stehen', () => {
    expect(type('Kinder- und Jugendarbeit ')).toBe('Kinder- und Jugendarbeit ');
    expect(type('- erster Punkt')).toBe('- erster Punkt');
    expect(type('---')).toBe('---');
    expect(type('E-Mail ')).toBe('E-Mail ');
  });

  it('macht aus drei Punkten Auslassungspunkte', () => {
    expect(type('Und dann... ')).toBe('Und dann… ');
    expect(type('Warte....')).toBe('Warte….');
  });
});
