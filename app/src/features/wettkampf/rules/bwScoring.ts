// Wettkampf-Wertung nach DJF-Wertungsbögen (Bundeswettbewerb, Stand 07.09.2013).
// Fehlerpunkte je Fehler; "perCase" = "je Fall" (mehrfach zählbar).

export interface FehlerDef {
  id: string;
  label: string;
  points: number;
  perCase?: boolean;
  /** Punktwert nicht am offiziellen Wertungsbogen geprüft. */
  unverified?: boolean;
}

export interface FehlerGroup {
  id: string;
  title: string;
  errors: FehlerDef[];
}

export type FehlerCounts = Record<string, number>;

export const A_VORGABE_PUNKTE = 1000;
export const B_VORGABE_PUNKTE = 400;

function psaA(prefix: string, brusttuch: string): FehlerDef[] {
  return [
    { id: `${prefix}-psa-anzug`, label: 'Kein DJF-Übungsanzug', points: 10 },
    { id: `${prefix}-psa-helm`, label: 'Kein DJF-Schutzhelm', points: 10 },
    { id: `${prefix}-psa-schuhe`, label: 'Kein festes Schuhwerk', points: 10 },
    { id: `${prefix}-psa-handschuhe`, label: 'Keine Schutzhandschuhe', points: 10 },
    { id: `${prefix}-psa-brusttuch`, label: `Kein Brusttuch ${brusttuch}`, points: 5 }
  ];
}

function psaB(prefix: string, nummer: number, withGurt: boolean): FehlerDef[] {
  return [
    { id: `${prefix}-psa-anzug`, label: 'Kein DJF-Übungsanzug', points: 10 },
    ...(withGurt ? [{ id: `${prefix}-psa-gurt`, label: 'Kein Schmalgurt m. Zweidornschnalle', points: 10 }] : []),
    { id: `${prefix}-psa-helm`, label: 'Kein DJF-Schutzhelm', points: 10 },
    { id: `${prefix}-psa-schuhe`, label: 'Keine Sportschuhe gem. Ausschreibung', points: 10 },
    { id: `${prefix}-psa-handschuhe`, label: 'Keine Schutzhandschuhe', points: 10 },
    { id: `${prefix}-psa-brusttuch`, label: `Kein Brusttuch Nummer ${nummer}`, points: 5 }
  ];
}

export const A_FEHLER_GROUPS: FehlerGroup[] = [
  {
    id: 'a-gm',
    title: 'Gruppenführer / Melder',
    errors: [
      ...psaA('a-gm', 'GF / Melder'),
      { id: 'a-gm-eb-wasser', label: 'Einsatzbefehl: Wasserentnahmestelle fehlt', points: 2 },
      { id: 'a-gm-eb-verteiler', label: 'Einsatzbefehl: Lage des Verteilers fehlt', points: 2 },
      { id: 'a-gm-eb-einheit', label: 'Einsatzbefehl: Einheit fehlt', points: 2, perCase: true },
      { id: 'a-gm-eb-auftrag', label: 'Einsatzbefehl: Auftrag fehlt', points: 2, perCase: true },
      { id: 'a-gm-eb-mittel', label: 'Einsatzbefehl: Mittel fehlt', points: 2, perCase: true },
      { id: 'a-gm-eb-ziel', label: 'Einsatzbefehl: Ziel fehlt', points: 2, perCase: true },
      { id: 'a-gm-eb-weg', label: 'Einsatzbefehl: Weg fehlt', points: 2, perCase: true },
      { id: 'a-gm-melderbefehl', label: 'Einsatzbefehl Melder nicht/zu früh/falsch', points: 5, perCase: true },
      { id: 'a-gm-handscheinwerfer', label: 'Fehlende Ausrüstung: Handscheinwerfer', points: 5 },
      { id: 'a-gm-melder-vorn', label: 'Melder nicht gemeinsam mit GF nach vorn', points: 2 },
      { id: 'a-gm-wassergraben', label: 'Fehler am Wassergraben', points: 5 },
      { id: 'a-gm-verteiler-ohne-befehl', label: 'Verteiler ohne Befehl übernommen', points: 5 },
      { id: 'a-gm-eb-wiederholt', label: 'Einsatzbefehl nicht/falsch wiederholt', points: 5 },
      { id: 'a-gm-verteiler-nicht-uebernommen', label: 'Verteiler nicht übernommen', points: 5 },
      { id: 'a-gm-hsw-verteiler', label: 'Bei Verteiler-Übernahme Handscheinwerfer vergessen', points: 5 },
      { id: 'a-gm-c-nicht-angekuppelt', label: 'C-Druckschlauch (ST) nicht angekuppelt', points: 10 },
      { id: 'a-gm-verteiler-vor', label: 'Verteiler vor "3. Rohr Wasser marsch!" geöffnet', points: 5 },
      { id: 'a-gm-verteiler-falsch', label: 'Verteiler nicht richtig geöffnet', points: 5 },
      { id: 'a-gm-verteiler-nicht', label: 'Verteiler nicht geöffnet', points: 10 },
      { id: 'a-gm-wasserhalt-frueh', label: '"Wasser halt!" zu früh gegeben', points: 5 },
      { id: 'a-gm-wasserhalt-nicht', label: '"Wasser halt!" nicht gegeben', points: 10 },
      { id: 'a-gm-verteiler-nicht-ganz-zu', label: 'Nach "Wasser halt!" Verteiler nicht ganz geschlossen', points: 5, perCase: true },
      { id: 'a-gm-verteiler-nicht-zu', label: 'Nach "Wasser halt!" Verteiler nicht geschlossen', points: 10, perCase: true },
      { id: 'a-gm-knotenbefehl-frueh', label: 'Befehl "Knoten und Stiche anlegen!" zu früh', points: 5 },
      { id: 'a-gm-knotenbefehl-spaet', label: 'Befehl "Knoten und Stiche anlegen!" zu spät', points: 10 },
      { id: 'a-gm-knotenbefehl-falsch', label: 'Befehl "Knoten und Stiche anlegen!" falsch', points: 5 },
      { id: 'a-gm-knotenbefehl-nicht', label: 'Befehl "Knoten und Stiche anlegen!" nicht', points: 10 },
      { id: 'a-gm-kriechtunnel', label: 'Kriechtunnel ausgelassen', points: 10 },
      { id: 'a-gm-hsw-knoten', label: 'Handscheinwerfer nicht zum Knotengestell', points: 5 },
      { id: 'a-gm-uebung-frueh', label: '"Übung beendet!" zu früh gegeben', points: 5 },
      { id: 'a-gm-uebung-nicht', label: '"Übung beendet!" nicht gegeben', points: 10 }
    ]
  },
  {
    id: 'a-ma',
    title: 'Maschinist',
    errors: [
      ...psaA('a-ma', 'Maschinist'),
      { id: 'a-ma-druckabgang-offen', label: 'Druckabgänge zu Beginn geöffnet', points: 5, perCase: true },
      { id: 'a-ma-blind-nicht', label: 'Blindkupplungen zu Beginn nicht angebracht', points: 5, perCase: true },
      { id: 'a-ma-blind-einer', label: 'Blindkupplung nur von einem Abgang entfernt', points: 5 },
      { id: 'a-ma-geraet-saugkorb', label: 'Gerät nicht bereitgelegt: Saugkorb', points: 5 },
      { id: 'a-ma-geraet-halteleine', label: 'Gerät nicht bereitgelegt: Halteleine', points: 5 },
      { id: 'a-ma-geraet-ventilleine', label: 'Gerät nicht bereitgelegt: Ventilleine', points: 5 },
      { id: 'a-ma-geraet-kupplungsschluessel', label: 'Gerät nicht bereitgelegt: Kupplungsschlüssel', points: 5, perCase: true },
      { id: 'a-ma-saug-vor', label: 'Saugleitung vor "Saugleitung hoch!" angekuppelt', points: 5 },
      { id: 'a-ma-saug-schluessel', label: 'Saugleitung nicht mit Kupplungsschlüssel angezogen', points: 5 },
      { id: 'a-ma-saug-nicht', label: 'Saugleitung nicht angekuppelt', points: 10 },
      { id: 'a-ma-halteleine-vor', label: 'Halteleine nicht vor Öffnen des Druckabgangs befestigt', points: 5 },
      { id: 'a-ma-halteleine-nicht', label: 'Halteleine nicht befestigt', points: 10 },
      { id: 'a-ma-ventilleine-nicht', label: 'Ventilleine nicht befestigt', points: 5 },
      { id: 'a-ma-b-nicht', label: 'B-Druckschlauch nicht angeschlossen', points: 10 },
      { id: 'a-ma-druckabgang-vor', label: 'Druckabgang vor "Wasser marsch!" geöffnet', points: 5 },
      { id: 'a-ma-druckabgang-falsch', label: 'Druckabgang nicht richtig geöffnet', points: 5 },
      { id: 'a-ma-druckabgang-nicht', label: 'Druckabgang nicht geöffnet', points: 10 }
    ]
  },
  {
    id: 'a-at',
    title: 'Angriffstrupp',
    errors: [
      ...psaA('a-at', 'ATF / ATM'),
      { id: 'a-at-eb-einheit', label: 'Einsatzbefehl nicht wiederholt: Einheit', points: 2 },
      { id: 'a-at-eb-auftrag', label: 'Einsatzbefehl nicht wiederholt: Auftrag', points: 2 },
      { id: 'a-at-eb-mittel', label: 'Einsatzbefehl nicht wiederholt: Mittel', points: 2 },
      { id: 'a-at-eb-ziel', label: 'Einsatzbefehl nicht wiederholt: Ziel', points: 2 },
      { id: 'a-at-eb-weg', label: 'Einsatzbefehl nicht wiederholt: Weg', points: 2 },
      { id: 'a-at-hsw', label: 'Fehlende Ausrüstung: Handscheinwerfer', points: 5 },
      { id: 'a-at-cm', label: 'Fehlende Ausrüstung: CM-Strahlrohr', points: 5 },
      { id: 'a-at-wassergraben', label: 'Fehler am Wassergraben', points: 5 },
      { id: 'a-at-verteiler-nicht', label: 'Verteiler nicht gesetzt', points: 10 },
      { id: 'a-at-c-nicht-verteiler', label: 'C-Druckschl. nicht zum Verteiler gebracht', points: 5, perCase: true },
      { id: 'a-at-c-falsch-abgang', label: 'C-Druckschlauch am falschen Abgang angekuppelt', points: 5 },
      { id: 'a-at-c-nicht-angekuppelt', label: 'C-Druckschlauch nicht am Verteiler angekuppelt', points: 10 },
      { id: 'a-at-c1-nicht-leiterwand', label: '1. C-Druckschlauch nicht unter Leiterwand verlegt', points: 10 },
      { id: 'a-at-leiterwand-aus', label: 'Leiterwand ausgelassen', points: 40 },
      { id: 'a-at-leiterwand-begangen', label: 'Leiterwand nicht leitermäßig begangen', points: 5, perCase: true },
      { id: 'a-at-geraet-leiterwand', label: 'Gerät nicht unter Leiterwand durchgeschoben', points: 10, perCase: true },
      { id: 'a-at-c1-verdreht', label: 'Schlauchverdrehung im 1. C-Druckschlauch', points: 5 },
      { id: 'a-at-c2-reserve-teil', label: '2. C-Druckschlauch nicht ganz als Reserve verlegt', points: 5 },
      { id: 'a-at-c2-reserve-nicht', label: '2. C-Druckschlauch nicht als Reserve verlegt', points: 10 },
      { id: 'a-at-standort-links', label: 'Standort nicht links der Markierung (40-m-Linie)', points: 5 },
      { id: 'a-at-rohr-marsch-frueh', label: '"1. Rohr Wasser marsch!" zu früh', points: 5 },
      { id: 'a-at-rohr-marsch-nicht', label: '"1. Rohr Wasser marsch!" nicht gegeben', points: 10 },
      { id: 'a-at-strahlrohr-nicht-auf', label: 'Strahlrohr nicht geöffnet', points: 10 },
      { id: 'a-at-rohr-halt-frueh', label: '"1. Rohr Wasser halt!" zu früh', points: 5 },
      { id: 'a-at-rohr-halt-nicht', label: '"1. Rohr Wasser halt!" nicht gegeben', points: 10 },
      { id: 'a-at-strahlrohr-vor-zu', label: 'Strahlrohr vor "Wasser halt!" geschlossen', points: 5 },
      { id: 'a-at-strahlrohr-nicht-zu', label: 'Strahlrohr nicht geschlossen', points: 10 },
      { id: 'a-at-strahlrohr-abgelegt', label: 'Strahlrohr vor "Wasser halt!" abgelegt', points: 5 },
      { id: 'a-at-standort-frueh', label: 'Standort an 40-m-Linie zu früh verlassen', points: 10 },
      { id: 'a-at-knoten-falsch', label: 'Knoten/Stich am Knotengestell falsch', points: 5 },
      { id: 'a-at-knoten-nicht', label: 'Knoten/Stich am Knotengestell nicht ausgeführt', points: 10 }
    ]
  },
  {
    id: 'a-wt',
    title: 'Wassertrupp',
    errors: [
      ...psaA('a-wt', 'WTF / WTM'),
      { id: 'a-wt-anzahl', label: 'Anzahl A-Saugschläuche nicht bestimmt', points: 2 },
      { id: 'a-wt-saug-nicht-ausgelegt', label: 'A-Saugschläuche nicht ausgelegt', points: 5 },
      { id: 'a-wt-saugkorb-schluessel', label: 'Saugkorb ohne Kupplungsschlüssel angekuppelt', points: 5 },
      { id: 'a-wt-saugkorb-nicht', label: 'Saugkorb nicht angekuppelt', points: 10 },
      { id: 'a-wt-saug-schluessel', label: 'A-Saugschläuche ohne Kupplungsschlüssel gekuppelt', points: 5, perCase: true },
      { id: 'a-wt-saug-nicht-gekuppelt', label: 'A-Saugschläuche nicht gekuppelt', points: 10, perCase: true },
      { id: 'a-wt-knoten-saugkorb-falsch', label: 'Knoten am Saugkorb falsch', points: 5 },
      { id: 'a-wt-knoten-saugkorb-nicht', label: 'Knoten am Saugkorb nicht ausgeführt', points: 10 },
      { id: 'a-wt-halbschlaege-wenig', label: 'Nicht ausreichend Halbschläge (3 Stück)', points: 5, perCase: true },
      { id: 'a-wt-halbschlaege-falsch', label: 'Halbschläge der Halteleine falsch angebracht', points: 5, perCase: true },
      { id: 'a-wt-ventilleine', label: 'Ventilleine nicht angebracht', points: 10 },
      { id: 'a-wt-hoch-frueh', label: '"Saugleitung hoch!" zu früh', points: 5 },
      { id: 'a-wt-hoch-nicht', label: '"Saugleitung hoch!" nicht gegeben', points: 10 },
      { id: 'a-wt-zuwasser-frueh', label: '"Saugleitung zu Wasser!" zu früh', points: 5 },
      { id: 'a-wt-zuwasser-nicht', label: '"Saugleitung zu Wasser!" nicht gegeben', points: 10 },
      { id: 'a-wt-saug-nicht-wasser', label: 'Saugleitung nicht zu Wasser gebracht', points: 5 },
      { id: 'a-wt-b-nicht-verlegt', label: 'B-Druckschlauch nicht von TS zum Verteiler verlegt', points: 10 },
      { id: 'a-wt-wassergraben', label: 'Fehler am Wassergraben', points: 5, perCase: true },
      { id: 'a-wt-b-verdreht', label: 'Schlauchverdrehung im B-Schlauch (TS–Verteiler)', points: 5 },
      { id: 'a-wt-b-nicht-gemeinsam', label: 'B-Druckschlauch nicht gemeinsam angekuppelt', points: 5 },
      { id: 'a-wt-b-nicht-verteiler', label: 'B-Druckschlauch nicht an Verteiler angekuppelt', points: 10 },
      { id: 'a-wt-marsch-frueh', label: '"Wasser marsch!" zum Maschinisten zu früh', points: 5 },
      { id: 'a-wt-marsch-nicht', label: '"Wasser marsch!" zum Maschinisten nicht', points: 10 },
      { id: 'a-wt-bereit-falsch', label: '"Wassertrupp einsatzbereit!" falsch gegeben', points: 5 },
      { id: 'a-wt-bereit-nicht', label: '"Wassertrupp einsatzbereit!" nicht gegeben', points: 10 },
      { id: 'a-wt-standort-vor-wdh', label: 'Standort vor Wiederholung des Einsatzbefehls verlassen', points: 5 },
      { id: 'a-wt-eb-einheit', label: 'Einsatzbefehl nicht wiederholt: Einheit', points: 2 },
      { id: 'a-wt-eb-auftrag', label: 'Einsatzbefehl nicht wiederholt: Auftrag', points: 2 },
      { id: 'a-wt-eb-mittel', label: 'Einsatzbefehl nicht wiederholt: Mittel', points: 2 },
      { id: 'a-wt-eb-ziel', label: 'Einsatzbefehl nicht wiederholt: Ziel', points: 2 },
      { id: 'a-wt-eb-weg', label: 'Einsatzbefehl nicht wiederholt: Weg', points: 2 },
      { id: 'a-wt-hsw', label: 'Fehlende Ausrüstung: Handscheinwerfer', points: 5 },
      { id: 'a-wt-cm', label: 'Fehlende Ausrüstung: CM-Strahlrohr', points: 5 },
      { id: 'a-wt-huerde-fehler', label: 'Fehler an der Hürde', points: 5 },
      { id: 'a-wt-huerde-aus', label: 'Hürde ausgelassen', points: 10 },
      { id: 'a-wt-standort-rechts', label: 'Standort nicht rechts der Markierung (40-m-Linie)', points: 5 },
      { id: 'a-wt-rohr-marsch-frueh', label: '"2. Rohr Wasser marsch!" zu früh', points: 5 },
      { id: 'a-wt-rohr-marsch-nicht', label: '"2. Rohr Wasser marsch!" nicht gegeben', points: 10 },
      { id: 'a-wt-strahlrohr-nicht-auf', label: 'Strahlrohr nicht geöffnet', points: 10 },
      { id: 'a-wt-rohr-halt-frueh', label: '"2. Rohr Wasser halt!" zu früh', points: 5 },
      { id: 'a-wt-rohr-halt-nicht', label: '"2. Rohr Wasser halt!" nicht gegeben', points: 10 },
      { id: 'a-wt-strahlrohr-vor-zu', label: 'Strahlrohr vor "Wasser halt!" geschlossen', points: 5 },
      { id: 'a-wt-strahlrohr-nicht-zu', label: 'Strahlrohr nicht geschlossen', points: 10 },
      { id: 'a-wt-strahlrohr-abgelegt', label: 'Strahlrohr vor "Wasser halt!" abgelegt', points: 5 },
      { id: 'a-wt-standort-frueh', label: 'Standort an 40-m-Linie zu früh verlassen', points: 10 },
      { id: 'a-wt-knoten-falsch', label: 'Knoten/Stich am Knotengestell falsch', points: 5 },
      { id: 'a-wt-knoten-nicht', label: 'Knoten/Stich am Knotengestell nicht ausgeführt', points: 10 }
    ]
  },
  {
    id: 'a-st',
    title: 'Schlauchtrupp',
    errors: [
      ...psaA('a-st', 'STF / STM'),
      { id: 'a-st-saug-nicht-ausgelegt', label: 'A-Saugschläuche nicht ausgelegt', points: 5 },
      { id: 'a-st-hilfe-kuppeln', label: 'Hilfestellung beim Kuppeln der Saugleitung fehlt', points: 5 },
      { id: 'a-st-hilfe-leinen', label: 'Hilfestellung beim Anbringen der Leinen fehlt', points: 5 },
      { id: 'a-st-saug-nicht-wasser', label: 'Saugleitung nicht mit zu Wasser gebracht', points: 5 },
      { id: 'a-st-wassergraben', label: 'Fehler am Wassergraben', points: 5, perCase: true },
      { id: 'a-st-c-nicht-verteiler', label: 'C-Druckschl. nicht zum Verteiler gebracht', points: 5, perCase: true },
      { id: 'a-st-ventil-falsch', label: 'Niederschraubventil nicht richtig geöffnet', points: 5, perCase: true },
      { id: 'a-st-ventil-nicht', label: 'Niederschraubventil nicht geöffnet', points: 10, perCase: true },
      { id: 'a-st-standort-vor-eb', label: 'Standort vor Einsatzbefehl für WT verlassen', points: 5 },
      { id: 'a-st-huerde-fehler', label: 'Fehler an der Hürde', points: 5, perCase: true },
      { id: 'a-st-huerde-aus', label: 'Hürde ausgelassen', points: 10, perCase: true },
      { id: 'a-st-wt-c2-nicht-ausgerollt', label: '2. C-Druckschlauch (WT) nicht ausgerollt', points: 10 },
      { id: 'a-st-standort-vor-rohr', label: 'Standort vor "2. Rohr Wasser marsch!" verlassen', points: 5 },
      { id: 'a-st-wt-c2-reserve-teil', label: '2. C-Druckschl. (WT) nicht ganz als Reserve verlegt', points: 5 },
      { id: 'a-st-wt-c1-frueh', label: '1. C-Druckschl. (WT) vor "2. Rohr Wasser marsch!" ausgerollt', points: 5 },
      { id: 'a-st-wt-c1-nicht-huerde', label: '1. C-Druckschl. (WT) nicht unter der Hürde verlegt', points: 10 },
      { id: 'a-st-wt-c1-verdreht', label: 'Schlauchverdrehung im 1. C-Druckschl. (WT)', points: 5 },
      { id: 'a-st-wt-c1-nicht-verlegt', label: '1. C-Druckschl. (WT) nicht verlegt', points: 10 },
      { id: 'a-st-c-falsch-abgang', label: 'C-Druckschlauch am falschen Abgang angekuppelt', points: 5 },
      { id: 'a-st-c-nicht-verteiler-ak', label: 'C-Druckschlauch nicht am Verteiler angekuppelt', points: 10 },
      { id: 'a-st-standort-vor-eigene-wdh', label: 'Standort vor Wiederholung des eigenen Einsatzbefehls verlassen', points: 5 },
      { id: 'a-st-eb-einheit', label: 'Einsatzbefehl nicht wiederholt: Einheit', points: 2 },
      { id: 'a-st-eb-auftrag', label: 'Einsatzbefehl nicht wiederholt: Auftrag', points: 2 },
      { id: 'a-st-eb-mittel', label: 'Einsatzbefehl nicht wiederholt: Mittel', points: 2 },
      { id: 'a-st-eb-ziel', label: 'Einsatzbefehl nicht wiederholt: Ziel', points: 2 },
      { id: 'a-st-eb-weg', label: 'Einsatzbefehl nicht wiederholt: Weg', points: 2 },
      { id: 'a-st-hsw', label: 'Fehlende Ausrüstung: Handscheinwerfer', points: 5 },
      { id: 'a-st-cm', label: 'Fehlende Ausrüstung: CM-Strahlrohr', points: 5 },
      { id: 'a-st-kriechtunnel-aus', label: 'Kriechtunnel ausgelassen', points: 10 },
      { id: 'a-st-c1-kriechtunnel', label: '1. C-Druckschl. nicht durch Kriechtunnel verlegt', points: 10 },
      { id: 'a-st-c1-verdreht', label: 'Schlauchverdrehung im 1. C-Druckschl. (ST)', points: 5 },
      { id: 'a-st-c2-reserve-teil', label: '2. C-Druckschl. (ST) nicht ganz als Reserve verlegt', points: 5 },
      { id: 'a-st-c2-reserve-nicht', label: '2. C-Druckschl. (ST) nicht als Reserve verlegt', points: 10 },
      { id: 'a-st-standort-markierung', label: 'Standort nicht li./re. der Markierung (40-m-Linie)', points: 5 },
      { id: 'a-st-rohr-marsch-frueh', label: '"3. Rohr Wasser marsch!" zu früh', points: 5 },
      { id: 'a-st-rohr-marsch-nicht', label: '"3. Rohr Wasser marsch!" nicht gegeben', points: 10 },
      { id: 'a-st-strahlrohr-nicht-auf', label: 'Strahlrohr nicht geöffnet', points: 10 },
      { id: 'a-st-rohr-halt-frueh', label: '"3. Rohr Wasser halt!" zu früh', points: 5 },
      { id: 'a-st-rohr-halt-nicht', label: '"3. Rohr Wasser halt!" nicht gegeben', points: 10 },
      { id: 'a-st-strahlrohr-vor-zu', label: 'Strahlrohr vor "Wasser halt!" geschlossen', points: 5 },
      { id: 'a-st-strahlrohr-nicht-zu', label: 'Strahlrohr nicht geschlossen', points: 10 },
      { id: 'a-st-strahlrohr-abgelegt', label: 'Strahlrohr vor "Wasser halt!" abgelegt', points: 5 }
    ]
  }
];

export const B_FEHLER_GROUPS: FehlerGroup[] = [
  {
    id: 'b-l1',
    title: 'Läufer 1',
    errors: [...psaB('b-l1', 1, false)]
  },
  {
    id: 'b-l2',
    title: 'Läufer 2',
    errors: [
      ...psaB('b-l2', 2, false),
      { id: 'b-l2-staffel', label: 'Staffelstab nicht korrekt übernommen', points: 10 }
    ]
  },
  {
    id: 'b-l3',
    title: 'Läufer 3',
    errors: [
      ...psaB('b-l3', 3, false),
      { id: 'b-l3-arbeiten-vor', label: 'Arbeiten vor Staffelstab-Übergabe', points: 50 },
      { id: 'b-l3-staffel', label: 'Staffelstab nicht korrekt übernommen', points: 10 },
      { id: 'b-l3-c-nicht-gerollt', label: 'C-Druckschlauch nicht einfach gerollt', points: 50 },
      { id: 'b-l3-c-abgelegt', label: 'Gerollten C-Druckschlauch nicht ordnungsgem. abgelegt', points: 5 }
    ]
  },
  {
    id: 'b-l4',
    title: 'Läufer 4',
    errors: [
      ...psaB('b-l4', 4, false),
      { id: 'b-l4-staffel', label: 'Staffelstab nicht korrekt übernommen', points: 10 },
      { id: 'b-l4-laufbrett-teil', label: 'Laufbrett nicht vollständig überlaufen', points: 5 },
      { id: 'b-l4-laufbrett-seitlich', label: 'Laufbrett seitlich verlassen', points: 5 },
      { id: 'b-l4-laufbrett-aus', label: 'Laufbrett ausgelassen', points: 10 }
    ]
  },
  {
    id: 'b-l5',
    title: 'Läufer 5',
    errors: [
      ...psaB('b-l5', 5, true),
      { id: 'b-l5-trage', label: 'Liegt nicht ordnungsgemäß auf der Krankentrage', points: 10 },
      { id: 'b-l5-arbeiten-vor', label: 'Arbeiten vor Ablage des Staffelstabes', points: 50 },
      { id: 'b-l5-staffel-handschuhe', label: 'Staffelstab nicht auf Schutzhandschuhe von L5 gelegt', points: 10 },
      { id: 'b-l5-bereich-teil', label: 'Bereich ohne vollständige Schutzausrüstung verlassen', points: 20 },
      { id: 'b-l5-bereich-ohne', label: 'Bereich ohne angelegte Schutzausrüstung verlassen', points: 50 }
    ]
  },
  {
    id: 'b-l6',
    title: 'Läufer 6',
    errors: [
      ...psaB('b-l6', 6, false),
      { id: 'b-l6-staffel', label: 'Staffelstab nicht korrekt übernommen', points: 10 }
    ]
  },
  {
    id: 'b-l7',
    title: 'Läufer 7',
    errors: [
      ...psaB('b-l7', 7, false),
      { id: 'b-l7-arbeiten-vor', label: 'Arbeiten vor Staffelstab-Übergabe', points: 50 },
      { id: 'b-l7-staffel', label: 'Staffelstab nicht korrekt übernommen', points: 10 },
      { id: 'b-l7-kuppeln', label: 'Mit L8 nicht ordnungsgemäß gekuppelt', points: 5 },
      { id: 'b-l7-uebergriff', label: 'Beim Kuppeln übergegriffen', points: 5 }
    ]
  },
  {
    id: 'b-l8',
    title: 'Läufer 8',
    errors: [
      ...psaB('b-l8', 8, false),
      { id: 'b-l8-arbeiten-vor', label: 'Arbeiten vor Staffelstab-Übergabe', points: 50 },
      { id: 'b-l8-staffel', label: 'Staffelstab nicht korrekt übernommen', points: 10 },
      { id: 'b-l8-kuppeln', label: 'Mit L7 nicht ordnungsgemäß gekuppelt', points: 5 },
      { id: 'b-l8-uebergriff', label: 'Beim Kuppeln übergegriffen', points: 5 },
      { id: 'b-l8-leinenbeutel', label: 'Leinenbeutel nicht am Schlauch', points: 5 },
      { id: 'b-l8-ankerstich', label: 'Doppelter Ankerstich nicht über Kupplungen / falsch', points: 5 },
      { id: 'b-l8-halberschlag', label: 'Halber Schlag nicht am Mundstück / falsch', points: 5 },
      { id: 'b-l8-schlag-nicht', label: 'Ganzer und halber Schlag nicht ausgeführt', points: 20 }
    ]
  },
  {
    id: 'b-l9',
    title: 'Läufer 9',
    errors: [
      ...psaB('b-l9', 9, false),
      { id: 'b-l9-arbeiten-vor', label: 'Arbeiten vor Staffelstab-Übergabe', points: 50 },
      { id: 'b-l9-staffel', label: 'Staffelstab nicht korrekt übernommen', points: 10 },
      { id: 'b-l9-uebertritt', label: 'Übertritt beim Werfen die 392-m-Markierung', points: 5 },
      { id: 'b-l9-leinenende', label: 'Leinenende bei Übungsende nicht vor 392-m-Markierung', points: 5 },
      { id: 'b-l9-leine-ziellinie', label: 'Feuerwehrleine nicht über Ziellinie / außerhalb Stangen', points: 10 },
      { id: 'b-l9-leine-form', label: 'Feuerwehrleine nicht in vorgesehener Form geworfen', points: 50 }
    ]
  }
];

// ---------------------------------------------------------------------------
// Wasserentnahme im A-Teil: je nach Wettbewerb wechselt die Aufgabe zwischen offenem Gewässer
// (Saugleitung) und Unterflurhydrant. Der Katalog oben ist der Saugleitungs-Bogen; für den Hydrant
// entfallen die reinen Saugleitungs-Fehler und es kommen Hydrant-Fehler dazu.
//
// ACHTUNG: Die Punktwerte der Hydrant-Fehler (`unverified: true`) sind aus den Saugleitungs-Fehlern
// abgeleitet und NICHT am offiziellen Wertungsbogen geprüft. Bitte vor einem Wettkampf abgleichen.
// ---------------------------------------------------------------------------

export type Wasserentnahme = 'saug' | 'hydrant';

export const WASSERENTNAHME_LABEL: Record<Wasserentnahme, string> = {
  saug: 'Saugleitung',
  hydrant: 'Hydrant',
};

/** Fehler, die es nur bei der Wasserentnahme aus offenem Gewässer gibt. */
export const A_SAUGLEITUNG_ONLY_IDS: string[] = [
  'a-ma-geraet-saugkorb',
  'a-ma-geraet-halteleine',
  'a-ma-geraet-ventilleine',
  'a-ma-saug-vor',
  'a-ma-saug-schluessel',
  'a-ma-saug-nicht',
  'a-ma-halteleine-vor',
  'a-ma-halteleine-nicht',
  'a-ma-ventilleine-nicht',
  'a-wt-anzahl',
  'a-wt-saug-nicht-ausgelegt',
  'a-wt-saugkorb-schluessel',
  'a-wt-saugkorb-nicht',
  'a-wt-saug-schluessel',
  'a-wt-saug-nicht-gekuppelt',
  'a-wt-knoten-saugkorb-falsch',
  'a-wt-knoten-saugkorb-nicht',
  'a-wt-halbschlaege-wenig',
  'a-wt-halbschlaege-falsch',
  'a-wt-ventilleine',
  'a-wt-hoch-frueh',
  'a-wt-hoch-nicht',
  'a-wt-zuwasser-frueh',
  'a-wt-zuwasser-nicht',
  'a-wt-saug-nicht-wasser',
  'a-st-saug-nicht-ausgelegt',
  'a-st-hilfe-kuppeln',
  'a-st-hilfe-leinen',
  'a-st-saug-nicht-wasser',
];

/** Zusätzliche Fehler beim Hydrant (ungeprüfte Punkte, siehe oben). */
export const A_HYDRANT_EXTRA: FehlerGroup[] = [
  {
    id: 'a-ma',
    title: 'Maschinist',
    errors: [{ id: 'a-ma-h-sammelstueck', label: 'Sammelstück nicht angekuppelt', points: 10, unverified: true }],
  },
  {
    id: 'a-wt',
    title: 'Wassertrupp',
    errors: [
      { id: 'a-wt-h-standrohr', label: 'Standrohr nicht gesetzt', points: 10, unverified: true },
      { id: 'a-wt-h-hydrant', label: 'Unterflurhydrant nicht geöffnet (mind. 2 Umdrehungen)', points: 10, unverified: true },
      { id: 'a-wt-h-spuelen', label: 'Hydrant nicht gespült', points: 5, unverified: true },
      { id: 'a-wt-h-b-standrohr', label: 'B-Druckschlauch nicht am Standrohr angekuppelt', points: 10, unverified: true },
    ],
  },
];

/** Der Fehlerkatalog, wie er im jeweiligen Modus (und bei der A-Teil-Variante) angezeigt werden soll. */
export function catalogFor(mode: string, variant: Wasserentnahme): FehlerGroup[] {
  const groups = getScoringConfig(mode).groups;
  if (mode !== 'a' || variant !== 'hydrant') return groups;
  const hidden = new Set(A_SAUGLEITUNG_ONLY_IDS);
  return groups.map((g) => ({
    ...g,
    errors: [
      ...g.errors.filter((e) => !hidden.has(e.id)),
      ...(A_HYDRANT_EXTRA.find((x) => x.id === g.id)?.errors ?? []),
    ],
  }));
}

// Schnellzugriff: die an der Seitenlinie am häufigsten gesehenen Fehler.
// Eigene IDs (rollenunabhängig) – fließen genauso in die Fehlerpunkt-Summe ein.
export const A_QUICK_FEHLER: FehlerDef[] = [
  { id: 'a-q-psa', label: 'PSA-Mangel', points: 10, perCase: true },
  { id: 'a-q-brusttuch', label: 'Brusttuch fehlt', points: 5, perCase: true },
  { id: 'a-q-kommando-frueh', label: 'Kommando zu früh', points: 5, perCase: true },
  { id: 'a-q-kommando-nicht', label: 'Kommando nicht gegeben', points: 10, perCase: true },
  { id: 'a-q-wassergraben', label: 'Fehler am Wassergraben', points: 5, perCase: true },
  { id: 'a-q-verdreht', label: 'Schlauchverdrehung', points: 5, perCase: true },
  { id: 'a-q-reserve', label: 'Schlauchreserve falsch', points: 5, perCase: true },
  { id: 'a-q-strahlrohr-zu', label: 'Strahlrohr nicht geschlossen', points: 10, perCase: true },
  { id: 'a-q-knoten-falsch', label: 'Knoten/Stich falsch', points: 5, perCase: true },
  { id: 'a-q-knoten-nicht', label: 'Knoten/Stich nicht ausgeführt', points: 10, perCase: true },
  { id: 'a-q-verteiler', label: 'Verteiler-Fehler', points: 5, perCase: true },
  { id: 'a-q-hindernis', label: 'Hindernis ausgelassen', points: 10, perCase: true }
];

export const B_QUICK_FEHLER: FehlerDef[] = [
  { id: 'b-q-psa', label: 'PSA-Mangel', points: 10, perCase: true },
  { id: 'b-q-brusttuch', label: 'Brusttuch fehlt', points: 5, perCase: true },
  { id: 'b-q-staffel', label: 'Staffelstab falsch übernommen', points: 10, perCase: true },
  { id: 'b-q-arbeiten-vor', label: 'Arbeiten vor Übergabe', points: 50, perCase: true },
  { id: 'b-q-laufbrett', label: 'Laufbrett-Fehler', points: 5, perCase: true },
  { id: 'b-q-kuppeln', label: 'Kupplungs-/Knotenfehler', points: 5, perCase: true },
  { id: 'b-q-c-rollen', label: 'C-Schlauch nicht einfach gerollt', points: 50, perCase: true },
  { id: 'b-q-leine', label: 'Leine falsch geworfen', points: 50, perCase: true }
];

function buildIndex(groups: FehlerGroup[], quick: FehlerDef[]): Record<string, FehlerDef> {
  const byId: Record<string, FehlerDef> = {};
  for (const group of groups) {
    for (const error of group.errors) {
      byId[error.id] = error;
    }
  }
  for (const error of quick) {
    byId[error.id] = error;
  }
  return byId;
}

// Der Index kennt auch die Hydrant-Fehler, damit gespeicherte Läufe beider Varianten richtig gezählt werden.
const A_BY_ID = buildIndex([...A_FEHLER_GROUPS, ...A_HYDRANT_EXTRA], A_QUICK_FEHLER);
const B_BY_ID = buildIndex(B_FEHLER_GROUPS, B_QUICK_FEHLER);

export function getScoringConfig(mode: string) {
  return mode === 'b'
    ? { vorgabe: B_VORGABE_PUNKTE, groups: B_FEHLER_GROUPS, quick: B_QUICK_FEHLER, byId: B_BY_ID }
    : { vorgabe: A_VORGABE_PUNKTE, groups: A_FEHLER_GROUPS, quick: A_QUICK_FEHLER, byId: A_BY_ID };
}

export function sumFehlerpunkte(mode: string, fehlerCounts: FehlerCounts | null | undefined): number {
  const { byId } = getScoringConfig(mode);
  let sum = 0;
  for (const [id, count] of Object.entries(fehlerCounts || {})) {
    const def = byId[id];
    if (def && count > 0) {
      sum += def.points * count;
    }
  }
  return sum;
}

export function resolveFehlerList(mode: string, fehlerCounts: FehlerCounts | null | undefined) {
  const { byId } = getScoringConfig(mode);
  return Object.entries(fehlerCounts || {})
    .filter(([, count]) => count > 0)
    .map(([id, count]) => {
      const def = byId[id];
      if (!def) {
        return null;
      }
      return { id, label: def.label, points: def.points, count, total: def.points * count };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => b.total - a.total);
}

// A-Teil: 1000 - Fehlerpunkte - 1 Pkt je Sekunde über Vorgabe.
// B-Teil: 400 - Fehlerpunkte +/- Sekunden-Differenz zur Soll-Zeit (schneller = Bonus).
export function computeScore(
  mode: string,
  totalMs: number | null | undefined,
  targetSeconds: number | null | undefined,
  fehlerpunkte: number,
) {
  const { vorgabe } = getScoringConfig(mode);
  const istSeconds = Math.round((totalMs || 0) / 1000);
  const hasTarget = typeof targetSeconds === 'number' && targetSeconds > 0;
  let timeAdjust = 0;
  if (hasTarget) {
    timeAdjust = mode === 'a' ? -Math.max(0, istSeconds - targetSeconds) : targetSeconds - istSeconds;
  }
  const total = Math.max(0, vorgabe - fehlerpunkte + timeAdjust);
  return {
    mode,
    vorgabe,
    fehlerpunkte,
    istSeconds,
    targetSeconds: hasTarget ? targetSeconds : null,
    timeAdjust,
    total
  };
}
