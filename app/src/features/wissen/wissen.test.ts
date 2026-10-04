import { describe, expect, it } from 'vitest';
import { matches, normalize, searchRules } from './search';
import { KNOT_GUIDES, POSITION_GUIDES, RULE_ENTRIES } from './bwKnowledge';
import { LSP_POSITION_GUIDES, LSP_RULE_ENTRIES } from './lspKnowledge';
import { ALL_POSITIONS } from '@/features/wettkampf/rules/positions';

describe('Suche', () => {
  it('ignoriert Groß-/Kleinschreibung, Umlaute und Reihenfolge', () => {
    expect(normalize('Übertreten Größe')).toBe('uebertreten groesse');
    expect(matches('KUPPELN b-schlauch', 'Kuppeln B-Schlauch')).toBe(true);
    expect(matches('schlauch kuppeln', 'Kuppeln B-Schlauch')).toBe(true);
    expect(matches('muster', 'Kuppeln')).toBe(false);
  });

  it('leere Suche trifft alles, Suche nach Umlaut-Schreibweise findet Treffer', () => {
    expect(searchRules(RULE_ENTRIES, '')).toHaveLength(RULE_ENTRIES.length);
    expect(searchRules(RULE_ENTRIES, 'staffelholz').map((r) => r.id)).toContain('rule-b-baton');
  });
});

describe('Inhalte', () => {
  const all = [...RULE_ENTRIES, ...LSP_RULE_ENTRIES];

  it('haben eindeutige IDs und gefüllte Pflichtfelder', () => {
    for (const list of [all, POSITION_GUIDES, LSP_POSITION_GUIDES, KNOT_GUIDES]) {
      expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    }
    for (const r of all) {
      expect(r.title && r.summary && r.details.length).toBeTruthy();
    }
    for (const k of KNOT_GUIDES) expect(k.steps.length).toBeGreaterThan(0);
  });

  it('Positions-Anleitungen verweisen auf vorhandene Positionen der Aufstellung', () => {
    const ids = new Set(ALL_POSITIONS.map((p) => p.id));
    for (const g of [...POSITION_GUIDES, ...LSP_POSITION_GUIDES]) expect(ids.has(g.id)).toBe(true);
  });

  it('enthält keine zu den Wertungsbögen widersprüchlichen Punktangaben mehr', () => {
    expect(RULE_ENTRIES.map((r) => r.id)).not.toContain('rule-knot');
    expect(RULE_ENTRIES.map((r) => r.id)).not.toContain('rule-overstep');
  });
});
