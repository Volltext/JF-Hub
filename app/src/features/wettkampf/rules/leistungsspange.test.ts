import { describe, expect, it } from 'vitest';
import {
  LSP_MINDESTPUNKTE,
  computeLspDisziplin,
  computeLspGesamt,
  punkteFuerWeite,
  punkteFuerZeit
} from './leistungsspange';

// Die Grenzwerte stammen aus der Wertungstabelle der DJF-Richtlinien (Ziff. 4.5 a).
// Sie sind der Kern der Leistungsspangen-Wertung – hier darf nichts verrutschen.

describe('punkteFuerZeit — Schnelligkeitsübung', () => {
  it('wertet die Gruppe nach der Tabelle 55/60/65/75', () => {
    expect(punkteFuerZeit('lsp-schnelligkeit', 'gruppe', 55)).toBe(4);
    expect(punkteFuerZeit('lsp-schnelligkeit', 'gruppe', 55.1)).toBe(3);
    expect(punkteFuerZeit('lsp-schnelligkeit', 'gruppe', 60)).toBe(3);
    expect(punkteFuerZeit('lsp-schnelligkeit', 'gruppe', 65)).toBe(2);
    expect(punkteFuerZeit('lsp-schnelligkeit', 'gruppe', 75)).toBe(1);
    expect(punkteFuerZeit('lsp-schnelligkeit', 'gruppe', 75.1)).toBe(0);
  });

  it('wertet die Staffel strenger nach 50/55/60/70', () => {
    expect(punkteFuerZeit('lsp-schnelligkeit', 'staffel', 50)).toBe(4);
    expect(punkteFuerZeit('lsp-schnelligkeit', 'staffel', 55)).toBe(3);
    expect(punkteFuerZeit('lsp-schnelligkeit', 'staffel', 60)).toBe(2);
    expect(punkteFuerZeit('lsp-schnelligkeit', 'staffel', 70)).toBe(1);
    expect(punkteFuerZeit('lsp-schnelligkeit', 'staffel', 70.1)).toBe(0);
  });
});

describe('punkteFuerZeit — Staffellauf', () => {
  it('wertet die Gruppe nach 3:30 / 3:45 / 4:00 / 4:15', () => {
    expect(punkteFuerZeit('lsp-staffellauf', 'gruppe', 210)).toBe(4);
    expect(punkteFuerZeit('lsp-staffellauf', 'gruppe', 225)).toBe(3);
    expect(punkteFuerZeit('lsp-staffellauf', 'gruppe', 240)).toBe(2);
    expect(punkteFuerZeit('lsp-staffellauf', 'gruppe', 255)).toBe(1);
    expect(punkteFuerZeit('lsp-staffellauf', 'gruppe', 256)).toBe(0);
  });

  it('wertet die Staffel nach 2:20 / 2:30 / 2:40 / 2:50', () => {
    expect(punkteFuerZeit('lsp-staffellauf', 'staffel', 140)).toBe(4);
    expect(punkteFuerZeit('lsp-staffellauf', 'staffel', 150)).toBe(3);
    expect(punkteFuerZeit('lsp-staffellauf', 'staffel', 160)).toBe(2);
    expect(punkteFuerZeit('lsp-staffellauf', 'staffel', 170)).toBe(1);
    expect(punkteFuerZeit('lsp-staffellauf', 'staffel', 171)).toBe(0);
  });

  it('liefert null ohne gemessene Zeit', () => {
    expect(punkteFuerZeit('lsp-staffellauf', 'gruppe', 0)).toBeNull();
    expect(punkteFuerZeit('lsp-staffellauf', 'gruppe', null)).toBeNull();
  });
});

describe('punkteFuerWeite — Kugelstoßen', () => {
  it('wertet die Gruppe nach 55/59/64/70 m Gesamtweite', () => {
    expect(punkteFuerWeite('gruppe', 5499)).toBe(0);
    expect(punkteFuerWeite('gruppe', 5500)).toBe(1);
    expect(punkteFuerWeite('gruppe', 5900)).toBe(1);
    expect(punkteFuerWeite('gruppe', 5901)).toBe(2);
    expect(punkteFuerWeite('gruppe', 6400)).toBe(2);
    expect(punkteFuerWeite('gruppe', 7000)).toBe(3);
    expect(punkteFuerWeite('gruppe', 7001)).toBe(4);
  });

  it('wertet die Staffel nach 36/39/42/46 m Gesamtweite', () => {
    expect(punkteFuerWeite('staffel', 3599)).toBe(0);
    expect(punkteFuerWeite('staffel', 3600)).toBe(1);
    expect(punkteFuerWeite('staffel', 3901)).toBe(2);
    expect(punkteFuerWeite('staffel', 4200)).toBe(2);
    expect(punkteFuerWeite('staffel', 4600)).toBe(3);
    expect(punkteFuerWeite('staffel', 4601)).toBe(4);
  });
});

describe('computeLspDisziplin', () => {
  it('rechnet eine gestoppte Zeit in Punkte um', () => {
    const ergebnis = computeLspDisziplin('lsp-schnelligkeit', 'gruppe', { totalMs: 58400 });
    expect(ergebnis!.punkte).toBe(3);
    expect(ergebnis!.nullwertung).toBe(false);
  });

  it('lässt eine angehakte Nullwertung jede Punktzahl stechen', () => {
    const ergebnis = computeLspDisziplin('lsp-schnelligkeit', 'gruppe', {
      totalMs: 50000,
      nullwertungIds: ['lsp-schnelligkeit-nw-kupplung']
    });
    expect(ergebnis!.punkte).toBe(0);
    expect(ergebnis!.nullwertung).toBe(true);
    expect(ergebnis!.gruende).toEqual(['Offenes Kupplungspaar']);
  });

  it('übernimmt bei bewerteten Disziplinen die Wertungsrichter-Punktzahl', () => {
    expect(computeLspDisziplin('lsp-loeschangriff', 'gruppe', { judgePoints: 3 })!.punkte).toBe(3);
    expect(computeLspDisziplin('lsp-fragen', 'gruppe', {})!.punkte).toBeNull();
  });
});

describe('computeLspGesamt', () => {
  const alleDisziplinen = (punkte: (number | null)[]) => ({
    'lsp-schnelligkeit': punkte[0],
    'lsp-kugelstossen': punkte[1],
    'lsp-staffellauf': punkte[2],
    'lsp-loeschangriff': punkte[3],
    'lsp-fragen': punkte[4]
  });

  it('addiert Übungspunkte und den Durchschnitt des Gesamteindrucks', () => {
    const gesamt = computeLspGesamt(alleDisziplinen([2, 2, 2, 3, 3]), [2, 2, 3, 2, 2]);
    expect(gesamt.uebungsSumme).toBe(12);
    expect(gesamt.gesamteindruckDurchschnitt).toBe(2.2);
    expect(gesamt.summe).toBe(14.2);
    expect(gesamt.bestanden).toBe(true);
    expect(gesamt.ausgeschieden).toBe(false);
  });

  it('scheidet unter der Mindestpunktzahl aus', () => {
    const gesamt = computeLspGesamt(alleDisziplinen([2, 2, 1, 1, 2]), [1, 1, 1, 1, 1]);
    expect(gesamt.summe).toBeLessThan(LSP_MINDESTPUNKTE);
    expect(gesamt.ausgeschieden).toBe(true);
  });

  it('scheidet bei einer 0-Wertung im Löschangriff aus', () => {
    const gesamt = computeLspGesamt(alleDisziplinen([4, 4, 4, 0, 3]), [3, 3, 3, 3, 3]);
    expect(gesamt.summe).toBeGreaterThanOrEqual(LSP_MINDESTPUNKTE);
    expect(gesamt.ausgeschieden).toBe(true);
    expect(gesamt.ausscheidegruende.join(' ')).toContain('Löschangriff');
  });

  it('scheidet bei einer 0-Wertung in der Fragenbeantwortung aus', () => {
    const gesamt = computeLspGesamt(alleDisziplinen([4, 4, 4, 3, 0]), [3, 3, 3, 3, 3]);
    expect(gesamt.ausgeschieden).toBe(true);
    expect(gesamt.ausscheidegruende.join(' ')).toContain('Fragenbeantwortung');
  });

  it('scheidet bei zwei 0-Wertungen aus', () => {
    const gesamt = computeLspGesamt(alleDisziplinen([0, 0, 4, 4, 4]), [4, 4, 4, 4, 4]);
    expect(gesamt.ausgeschieden).toBe(true);
    expect(gesamt.ausscheidegruende).toContain('Mehr als eine 0-Wertung.');
  });

  it('scheidet bei mangelhaftem Gesamteindruck aus', () => {
    const gesamt = computeLspGesamt(alleDisziplinen([4, 4, 4, 4, 4]), [0, 0, 0, 0, 0]);
    expect(gesamt.ausgeschieden).toBe(true);
    expect(gesamt.ausscheidegruende).toContain('Der Gesamteindruck ist mangelhaft.');
  });

  it('bietet die Wiederholung bei einer 0-Wertung in einer sportlichen Disziplin an', () => {
    const gesamt = computeLspGesamt(alleDisziplinen([0, 3, 3, 3, 3]), [2, 2, 2, 2, 2]);
    expect(gesamt.ausgeschieden).toBe(false);
    expect(gesamt.summe).toBeGreaterThanOrEqual(LSP_MINDESTPUNKTE);
    expect(gesamt.wiederholungMoeglich).toBe(true);
    expect(gesamt.bestanden).toBe(false);
  });

  it('bleibt unvollständig, solange nicht alle Disziplinen bewertet sind', () => {
    const gesamt = computeLspGesamt({ 'lsp-schnelligkeit': 3 }, [3, null, null, null, null]);
    expect(gesamt.vollstaendig).toBe(false);
    expect(gesamt.bestanden).toBe(false);
    expect(gesamt.ausgeschieden).toBe(false);
  });
});
