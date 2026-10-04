import { describe, expect, it } from 'vitest';
import { markersFor } from './modes';
import { runModeLabel } from '../run';
import {
  A_FEHLER_GROUPS,
  A_HYDRANT_EXTRA,
  A_QUICK_FEHLER,
  A_SAUGLEITUNG_ONLY_IDS,
  catalogFor,
  B_FEHLER_GROUPS,
  B_QUICK_FEHLER,
  computeScore,
  resolveFehlerList,
  sumFehlerpunkte,
} from './bwScoring';
import { LSP_GRUPPE_VON_A_TEIL, LSP_STAFFEL_VON_A_TEIL, ALL_POSITIONS } from './positions';

describe('Fehlerkataloge', () => {
  it('haben eindeutige IDs und positive Punkte', () => {
    for (const [groups, quick] of [
      [A_FEHLER_GROUPS, A_QUICK_FEHLER],
      [B_FEHLER_GROUPS, B_QUICK_FEHLER],
    ] as const) {
      const all = [...groups.flatMap((g) => g.errors), ...quick];
      expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
      expect(all.every((e) => e.points > 0)).toBe(true);
    }
  });
});

describe('sumFehlerpunkte / resolveFehlerList', () => {
  it('multipliziert Punkte mit der Anzahl und ignoriert unbekannte IDs und Nullen', () => {
    const counts = { 'a-q-psa': 2, 'a-q-brusttuch': 1, unbekannt: 5, 'a-q-verdreht': 0 };
    expect(sumFehlerpunkte('a', counts)).toBe(2 * 10 + 5);
    expect(sumFehlerpunkte('a', null)).toBe(0);
  });

  it('listet größte Abzüge zuerst', () => {
    const list = resolveFehlerList('a', { 'a-q-brusttuch': 1, 'a-q-psa': 2 });
    expect(list.map((e) => e.id)).toEqual(['a-q-psa', 'a-q-brusttuch']);
    expect(list[0]!.total).toBe(20);
  });
});

describe('computeScore', () => {
  it('A-Teil: 1000 − Fehler − 1 Punkt je Sekunde über Vorgabe', () => {
    const s = computeScore('a', 95_000, 90, 15);
    expect(s.total).toBe(1000 - 15 - 5);
    expect(s.timeAdjust).toBe(-5);
  });

  it('A-Teil: schneller als die Vorgabe gibt keinen Bonus', () => {
    expect(computeScore('a', 80_000, 90, 0).total).toBe(1000);
  });

  it('B-Teil: 400 − Fehler ± Differenz zur Soll-Zeit, schneller = Bonus', () => {
    expect(computeScore('b', 100_000, 110, 20).total).toBe(400 - 20 + 10);
    expect(computeScore('b', 120_000, 110, 0).total).toBe(400 - 10);
  });

  it('ohne Soll-Zeit gibt es keine Zeitkorrektur und das Ergebnis wird nie negativ', () => {
    expect(computeScore('a', 999_000, null, 0).total).toBe(1000);
    expect(computeScore('b', 1000, 0, 5000).total).toBe(0);
  });
});

describe('A-Teil → Leistungsspange', () => {
  it('verweist nur auf vorhandene Positionen', () => {
    const ids = new Set(ALL_POSITIONS.map((p) => p.id));
    for (const map of [LSP_GRUPPE_VON_A_TEIL, LSP_STAFFEL_VON_A_TEIL])
      for (const [ziel, quelle] of Object.entries(map)) {
        expect(ids.has(ziel)).toBe(true);
        expect(ids.has(quelle)).toBe(true);
      }
  });

  it('Staffel: Führer entspricht dem A-Teil-Gruppenführer, kein Melder und kein Schlauchtrupp', () => {
    expect(LSP_STAFFEL_VON_A_TEIL['lsp-s-staffelfuehrer']).toBe('a-gruppenfuehrer');
    expect(Object.keys(LSP_STAFFEL_VON_A_TEIL)).toHaveLength(6);
  });
});

describe('Wasserentnahme: Saugleitung / Hydrant', () => {
  const ids = (groups: { errors: { id: string }[] }[]) => groups.flatMap((g) => g.errors.map((e) => e.id));

  it('Saugleitung zeigt den unveränderten Katalog', () => {
    expect(catalogFor('a', 'saug')).toBe(A_FEHLER_GROUPS);
    expect(catalogFor('b', 'hydrant')).toBe(B_FEHLER_GROUPS);
  });

  it('alle ausgeblendeten IDs existieren im Saugleitungs-Katalog', () => {
    const all = new Set(ids(A_FEHLER_GROUPS));
    for (const id of A_SAUGLEITUNG_ONLY_IDS) expect(all.has(id)).toBe(true);
  });

  it('Hydrant blendet Saugleitungs-Fehler aus und ergänzt Hydrant-Fehler (als ungeprüft markiert)', () => {
    const hydrant = catalogFor('a', 'hydrant');
    const shown = new Set(ids(hydrant));
    for (const id of A_SAUGLEITUNG_ONLY_IDS) expect(shown.has(id)).toBe(false);
    expect(shown.has('a-wt-h-standrohr')).toBe(true);
    expect(shown.has('a-ma-h-sammelstueck')).toBe(true);
    // gemeinsame Fehler bleiben
    expect(shown.has('a-gm-verteiler-nicht')).toBe(true);
    for (const e of A_HYDRANT_EXTRA.flatMap((g) => g.errors)) expect(e.unverified).toBe(true);
    expect(hydrant.map((g) => g.id)).toEqual(A_FEHLER_GROUPS.map((g) => g.id));
  });

  it('gespeicherte Läufe beider Varianten werden richtig gezählt', () => {
    expect(sumFehlerpunkte('a', { 'a-wt-h-standrohr': 1, 'a-wt-saug-nicht-ausgelegt': 1 })).toBe(10 + 5);
    expect(resolveFehlerList('a', { 'a-wt-h-spuelen': 2 })[0]).toMatchObject({ total: 10 });
  });

  it('Zwischenzeit-Knöpfe und Beschriftung folgen der Variante', () => {
    expect(markersFor('a', 'saug')).toEqual(['zu Wasser', 'Knoten Start']);
    expect(markersFor('a', 'hydrant')).toEqual(['Wasser marsch', 'Knoten Start']);
    expect(markersFor('b', 'hydrant')).toEqual(['Schlauchrollen', 'L7/L8 Team', 'Anziehen']);
    expect(runModeLabel({ mode: 'a', wasserentnahme: 'hydrant' })).toBe('A-Teil (Hydrant)');
    expect(runModeLabel({ mode: 'a' })).toBe('A-Teil');
    expect(runModeLabel({ mode: 'b', wasserentnahme: 'hydrant' })).toBe('B-Teil');
  });
});
