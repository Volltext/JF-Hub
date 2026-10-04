// Leistungsspange der Deutschen Jugendfeuerwehr — Regelwerk und Wertungslogik.
//
// QUELLEN (beide Stand 01.01.2024, gültig ab 1. Januar 2024):
//   [R]  „Richtlinien zum Erwerb der Leistungsspange der Deutschen Jugendfeuerwehr",
//        Fachausschuss Wettbewerbe der DJF — Ziff. 3 (Bedingungen), Ziff. 4 (Bewertung).
//   [E]  „Erläuterungen zur bundeseinheitlichen Durchführung und Bewertung der
//        Leistungsspangenabnahme der Deutschen Jugendfeuerwehr" — Nullwertungen je Übung.
//
// Ändern sich die Richtlinien, ist dieses Modul die einzige Stelle, die angefasst
// werden muss. Zeiten laufen in Sekunden, Weiten in Zentimetern — so bleiben alle
// Vergleiche ganzzahlig und die Grenzfälle der Wertungstabelle eindeutig.

export interface LspVariante {
  id: string;
  label: string;
  staerke: number;
  schlaeuche: number;
  cRohre: number;
  laufstreckeM: number;
  kugelMindestCm: number;
  brusttuecherSchnelligkeit: string;
  brusttuecherSport: string;
}

export const LSP_VARIANTEN: LspVariante[] = [
  {
    id: 'gruppe',
    label: 'Gruppe',
    staerke: 9,
    schlaeuche: 8,
    cRohre: 3,
    laufstreckeM: 1500,
    kugelMindestCm: 5500,
    brusttuecherSchnelligkeit: '1–8 (Einheitsführer/-in ohne Brusttuch)',
    brusttuecherSport: '1–9'
  },
  {
    id: 'staffel',
    label: 'Staffel',
    staerke: 6,
    schlaeuche: 5,
    cRohre: 2,
    laufstreckeM: 1000,
    kugelMindestCm: 3600,
    brusttuecherSchnelligkeit: '1–5 (Einheitsführer/-in ohne Brusttuch)',
    brusttuecherSport: '1–6'
  }
];

export const LSP_VARIANTE_IDS = LSP_VARIANTEN.map((variante) => variante.id);

export function getLspVariante(varianteId: string | null | undefined): LspVariante {
  return LSP_VARIANTEN.find((variante) => variante.id === varianteId) ?? LSP_VARIANTEN[0]!;
}

// [R] 4.5 a — Zeit-Disziplinen, absteigend geprüft: „bis 55" → 4 … „über 75" → 0.
// Staffellauf in Sekunden: 3:30 = 210, 3:45 = 225, 4:00 = 240, 4:15 = 255,
// bzw. 2:20 = 140, 2:30 = 150, 2:40 = 160, 2:50 = 170.
type ZeitStufe = { punkte: number; bisSekunden: number };
const ZEIT_TABELLE: Record<string, Record<string, ZeitStufe[]>> = {
  'lsp-schnelligkeit': {
    gruppe: [
      { punkte: 4, bisSekunden: 55 },
      { punkte: 3, bisSekunden: 60 },
      { punkte: 2, bisSekunden: 65 },
      { punkte: 1, bisSekunden: 75 }
    ],
    staffel: [
      { punkte: 4, bisSekunden: 50 },
      { punkte: 3, bisSekunden: 55 },
      { punkte: 2, bisSekunden: 60 },
      { punkte: 1, bisSekunden: 70 }
    ]
  },
  'lsp-staffellauf': {
    gruppe: [
      { punkte: 4, bisSekunden: 210 },
      { punkte: 3, bisSekunden: 225 },
      { punkte: 2, bisSekunden: 240 },
      { punkte: 1, bisSekunden: 255 }
    ],
    staffel: [
      { punkte: 4, bisSekunden: 140 },
      { punkte: 3, bisSekunden: 150 },
      { punkte: 2, bisSekunden: 160 },
      { punkte: 1, bisSekunden: 170 }
    ]
  }
};

// [R] 4.5 a — Kugelstoßen, aufsteigend geprüft: „unter 55" → 0, „bis 59" → 1,
// „bis 64" → 2, „bis 70" → 3, „über 70" → 4 (Gesamtweite aller Stöße).
type KugelTabelle = { mindestCm: number; stufen: { punkte: number; bisCm: number }[]; hoechstePunkte: number };
const KUGEL_TABELLE: Record<string, KugelTabelle> = {
  gruppe: {
    mindestCm: 5500,
    stufen: [
      { punkte: 1, bisCm: 5900 },
      { punkte: 2, bisCm: 6400 },
      { punkte: 3, bisCm: 7000 }
    ],
    hoechstePunkte: 4
  },
  staffel: {
    mindestCm: 3600,
    stufen: [
      { punkte: 1, bisCm: 3900 },
      { punkte: 2, bisCm: 4200 },
      { punkte: 3, bisCm: 4600 }
    ],
    hoechstePunkte: 4
  }
};

// [R] 4.5 d — Punktewertung des Gesamteindrucks.
export const LSP_GESAMTEINDRUCK_SKALA = [
  { punkte: 0, label: 'mangelhaft', zusatz: 'nicht bestanden' },
  { punkte: 1, label: 'genügend', zusatz: 'bestanden' },
  { punkte: 2, label: 'befriedigend', zusatz: 'befriedigend bestanden' },
  { punkte: 3, label: 'gut', zusatz: 'gut bestanden' },
  { punkte: 4, label: 'sehr gut', zusatz: 'sehr gut bestanden' }
];

// [R] 4.4 — jede/-r der fünf Wertungsrichter/-innen ist für einen Wertungsteil
// zuständig und beurteilt zusätzlich den Gesamteindruck der Einheit.
export const LSP_WERTUNGSRICHTER = [
  'Wertung 1 · Schnelligkeitsübung',
  'Wertung 2 · Kugelstoßen',
  'Wertung 3 · Staffellauf',
  'Wertung 4 · Löschangriff',
  'Wertung 5 · Fragenbeantwortung'
];

export const LSP_MINDESTPUNKTE = 10;

// [R] 3.1 — Reihenfolge der fünf Bedingungen.
export type LspKind = 'timed' | 'measured' | 'judged';

export interface LspDisziplin {
  id: string;
  label: string;
  shortLabel: string;
  kind: LspKind;
  wiederholbar: boolean;
  sportkleidung: boolean;
  kurz: string;
  hinweise: string[];
  nullwertungen: { id: string; label: string }[];
}

export const LSP_DISZIPLINEN: LspDisziplin[] = [
  {
    id: 'lsp-schnelligkeit',
    label: 'Schnelligkeitsübung',
    shortLabel: 'Schnelligkeit',
    kind: 'timed',
    wiederholbar: true,
    sportkleidung: false,
    kurz: 'Schlauchleitung aus doppelt gerolltem C-Druckschlauch auf 120 m auslegen und kuppeln.',
    hinweise: [
      'Gruppe verlegt 8, Staffel 5 C-Druckschläuche (Rollschläuche 15 m).',
      'Ziellinie liegt bei Gruppe und Staffel gleichermaßen 120 m hinter der Startlinie.',
      'Startkommando „Auf die Plätze – fertig – los!", Ende mit „Fertig!" und Handzeichen.',
      'Jedes Kupplungspaar wird von zwei Mitgliedern gekuppelt, der 1. Schlauch an die Festkupplung.'
    ],
    nullwertungen: [
      { id: 'lsp-schnelligkeit-nw-zeit', label: 'Zeitüberschreitung' },
      { id: 'lsp-schnelligkeit-nw-kupplung', label: 'Offenes Kupplungspaar' },
      { id: 'lsp-schnelligkeit-nw-verdrehung', label: 'Verdrehung innerhalb eines Schlauches' },
      { id: 'lsp-schnelligkeit-nw-partner', label: 'Nicht mit Vorgänger/-in bzw. Nachfolger/-in gekuppelt' }
    ]
  },
  {
    id: 'lsp-kugelstossen',
    label: 'Kugelstoßen',
    shortLabel: 'Kugel',
    kind: 'measured',
    wiederholbar: true,
    sportkleidung: true,
    kurz: 'Je ein Stoß aller Mitglieder, die Einzelweiten werden zur Gesamtweite addiert.',
    hinweise: [
      'Männliche Bewerber stoßen mit 4 kg, weibliche mit 3 kg.',
      'Mindestweite: Gruppe 55 m gesamt, Staffel 36 m gesamt.',
      'Höchstens zwei Schritte Anlauf; die Markierungsleiste darf nicht be- oder übertreten werden.',
      'Der Veranstalter teilt mit, ob fortlaufend vom Auftreffpunkt, von fester Linie oder aus dem Kugelstoßring gestoßen wird.'
    ],
    nullwertungen: [
      { id: 'lsp-kugelstossen-nw-weite', label: 'Mindestweite nicht erreicht' }
    ]
  },
  {
    id: 'lsp-staffellauf',
    label: 'Staffellauf',
    shortLabel: 'Staffel',
    kind: 'timed',
    wiederholbar: true,
    sportkleidung: true,
    kurz: 'Gruppe 1.500 m, Staffel 1.000 m in frei einzuteilenden Teilstrecken.',
    hinweise: [
      'Jedes Mitglied läuft genau einmal, die Teilstrecken sind frei einteilbar.',
      'Als Stafette dient ein Staffelstab, der bei jedem Wechsel übergeben wird.',
      'Spikes- und Stollenschuhe sind nicht zulässig.'
    ],
    nullwertungen: [
      { id: 'lsp-staffellauf-nw-bahn', label: 'Verlassen der Laufbahn zur Erreichung eines Vorteils' },
      { id: 'lsp-staffellauf-nw-zeit', label: 'Zeitüberschreitung' },
      { id: 'lsp-staffellauf-nw-unvollstaendig', label: 'Nicht alle Mitglieder eingesetzt' },
      { id: 'lsp-staffellauf-nw-doppelt', label: 'Ein Mitglied wurde zweimal eingesetzt' },
      { id: 'lsp-staffellauf-nw-stab', label: 'Staffelstab erreicht die Ziellinie nicht' },
      { id: 'lsp-staffellauf-nw-fehlstart', label: 'Dreimaliger Fehlstart' },
      { id: 'lsp-staffellauf-nw-behinderung', label: 'Behinderung einer anderen Läuferin / eines anderen Läufers' }
    ]
  },
  {
    id: 'lsp-loeschangriff',
    label: 'Löschangriff',
    shortLabel: 'Löschangriff',
    kind: 'judged',
    wiederholbar: false,
    sportkleidung: false,
    kurz: 'Schulungsmäßiger Löschangriff nach FwDV 3 — ohne Wasserabgabe, ohne Bereitstellung.',
    hinweise: [
      'Wasserentnahme offenes Gewässer mit vier Saugschläuchen.',
      'Doppelt gerollte C-Schläuche; zügige Vornahme von 3 C-Rohren (Gruppe) bzw. 2 C-Rohren (Staffel).',
      'Brusttücher mit taktischen Zeichen; Schutzhandschuhe sind zu tragen.',
      'Das benötigte Gerät bereitet die Einheit selbstständig auf dem Ablageplatz vor.'
    ],
    nullwertungen: [
      { id: 'lsp-loeschangriff-nw-wasser', label: 'Wasserabgabe an allen Strahlrohren theoretisch nicht möglich' },
      { id: 'lsp-loeschangriff-nw-fwdv', label: 'Löschangriff nicht nach gültiger Feuerwehr-Dienstvorschrift vorgetragen' }
    ]
  },
  {
    id: 'lsp-fragen',
    label: 'Fragenbeantwortung',
    shortLabel: 'Fragen',
    kind: 'judged',
    wiederholbar: false,
    sportkleidung: false,
    kurz: 'Etwa 15-minütiges Gespräch der/des Wertungsrichter/-in mit der ganzen Einheit.',
    hinweise: [
      'Bewertet wird das Wissen der gesamten Bewerbergruppe, nicht das einzelner Mitglieder.',
      'Das Gespräch findet unter Ausschluss der Öffentlichkeit statt.',
      'Herkunft und örtliche Gegebenheiten der Feuerwehr sollen berücksichtigt werden.'
    ],
    nullwertungen: [
      { id: 'lsp-fragen-nw-wissen', label: 'Fragen konnten nicht ausreichend beantwortet werden' }
    ]
  }
];

export const LSP_DISZIPLIN_IDS = LSP_DISZIPLINEN.map((disziplin) => disziplin.id);

export function getLspDisziplin(disziplinId: string): LspDisziplin | null {
  return LSP_DISZIPLINEN.find((disziplin) => disziplin.id === disziplinId) ?? null;
}

export function isLspDisziplin(disziplinId: string): boolean {
  return LSP_DISZIPLIN_IDS.includes(disziplinId);
}

// [R] 3.6 — die sieben Wissensgebiete. Bewusst als Gesprächsleitfaden und nicht als
// abprüfbarer Fragenkatalog: die Erläuterungen [E] halten ausdrücklich fest, dass
// „Fragenkataloge oder ähnliches hier keine Berechtigung" haben.
export const LSP_FRAGEN_HINWEIS =
  'Fragenkataloge oder ähnliches haben hier keine Berechtigung. Die folgenden Gebiete sind ein '
  + 'Leitfaden fürs Training — im Gespräch zählt das Grundwissen der ganzen Einheit, bezogen auf '
  + 'die eigene Feuerwehr und die örtlichen Gegebenheiten.';

export const LSP_FRAGEN_GEBIETE = [
  {
    id: 'lsp-gebiet-organisation',
    label: 'Organisation',
    impulse: [
      'Aufbau der eigenen Feuerwehr und der Jugendfeuerwehr: Wer leitet was?',
      'Gliederung von Gruppe und Staffel nach FwDV 3 und die Aufgaben der Funktionen.',
      'Alarmierung und Meldewege im eigenen Ausrückebereich.'
    ]
  },
  {
    id: 'lsp-gebiet-ausruestung',
    label: 'Ausrüstung',
    impulse: [
      'Persönliche Schutzausrüstung: Bestandteile und wozu jedes Teil dient.',
      'Bekleidung nach DJF-Bekleidungsrichtlinie.',
      'Kennzeichnung der Funktionen über Brusttücher und taktische Zeichen.'
    ]
  },
  {
    id: 'lsp-gebiet-geraete',
    label: 'Geräte',
    impulse: [
      'Schläuche, Kupplungen, Armaturen: Bezeichnung, Länge, Durchmesser.',
      'Tragkraftspritze und Saugleitung: Aufbau und Handhabung.',
      'Rettungs- und Arbeitsgeräte auf dem eigenen Fahrzeug.'
    ]
  },
  {
    id: 'lsp-gebiet-loeschmittel',
    label: 'Löschmittel',
    impulse: [
      'Wasser, Schaum, Pulver, CO₂ — Eigenschaften und Grenzen.',
      'Brandklassen und das jeweils passende Löschmittel.',
      'Wo Wasser als Löschmittel gefährlich wird.'
    ]
  },
  {
    id: 'lsp-gebiet-loeschverfahren',
    label: 'Löschverfahren der Feuerwehr',
    impulse: [
      'Voraussetzungen für eine Verbrennung und die daraus folgenden Löschwirkungen.',
      'Wasserentnahmestellen: offenes Gewässer, Hydrant, Löschwasserbehälter.',
      'Aufbau einer Wasserförderung über lange Wegstrecke.'
    ]
  },
  {
    id: 'lsp-gebiet-unfallverhuetung',
    label: 'Unfallverhütung',
    impulse: [
      'Sicheres Arbeiten an der Tragkraftspritze und mit Saugschläuchen.',
      'Gefahren der Einsatzstelle und wie man sich davor schützt.',
      'Warum Schutzhandschuhe bei den feuerwehrtechnischen Übungsteilen Pflicht sind.'
    ]
  },
  {
    id: 'lsp-gebiet-jugendpolitik',
    label: 'Gesellschafts- und Jugendpolitik',
    impulse: [
      'Aufgaben und Ziele der Deutschen Jugendfeuerwehr.',
      'Mitbestimmung in der Jugendfeuerwehr: Jugendsprecher/-in, Jugendforum.',
      'Ehrenamt, Demokratie und Zusammenhalt in der Gemeinschaft.'
    ]
  }
];

// Beobachtungshilfe für den Löschangriff: [E] verweist ausdrücklich auf die
// Wettbewerbsordnung des Bundeswettbewerbs, Kapitel 4, „unter Weglassen der
// Hindernisse". Diese Fehler-IDs aus `scoring.js` gehören zu den Hindernissen des
// A-Teils (Wassergraben, Leiterwand, Kriechtunnel) und werden deshalb ausgeblendet.
export const LSP_OHNE_HINDERNIS_FEHLER_IDS = [
  'a-gm-wassergraben',
  'a-gm-kriechtunnel',
  'a-at-wassergraben',
  'a-at-c1-nicht-leiterwand',
  'a-at-leiterwand-aus',
  'a-at-leiterwand-begangen',
  'a-at-geraet-leiterwand',
  'a-wt-wassergraben',
  'a-st-wassergraben',
  'a-st-kriechtunnel-aus',
  'a-st-c1-kriechtunnel'
];

// Punkte einer Zeit-Disziplin. `sekunden` darf Nachkommastellen haben; verglichen
// wird auf Millisekunden genau, damit 55,0 s noch 4 Punkte und 55,1 s bereits
// 3 Punkte ergibt.
export function punkteFuerZeit(disziplinId: string, varianteId: string, sekunden: number | null | undefined): number | null {
  const stufen = ZEIT_TABELLE[disziplinId]?.[varianteId];
  if (!stufen || typeof sekunden !== 'number' || !Number.isFinite(sekunden) || sekunden <= 0) {
    return null;
  }

  const millisekunden = Math.round(sekunden * 1000);
  for (const stufe of stufen) {
    if (millisekunden <= stufe.bisSekunden * 1000) {
      return stufe.punkte;
    }
  }
  return 0;
}

// Punkte für die addierte Gesamtweite beim Kugelstoßen (in Zentimetern).
export function punkteFuerWeite(varianteId: string, zentimeter: number | null | undefined): number | null {
  const tabelle = KUGEL_TABELLE[varianteId];
  if (!tabelle || typeof zentimeter !== 'number' || !Number.isFinite(zentimeter) || zentimeter <= 0) {
    return null;
  }

  if (zentimeter < tabelle.mindestCm) {
    return 0;
  }
  for (const stufe of tabelle.stufen) {
    if (zentimeter <= stufe.bisCm) {
      return stufe.punkte;
    }
  }
  return tabelle.hoechstePunkte;
}

// Liefert die Zeit-/Weitenschwelle, ab der die nächsthöhere Punktzahl erreicht wird.
// Damit kann die Stoppuhr live anzeigen, wie viel noch fehlt.
export type NaechsteStufe = { punkte: number; bisSekunden?: number; abCm?: number } | null;

export function naechsteStufe(disziplinId: string, varianteId: string, aktuellePunkte: number | null): NaechsteStufe {
  if (typeof aktuellePunkte !== 'number' || aktuellePunkte >= 4) {
    return null;
  }

  const zeitStufen = ZEIT_TABELLE[disziplinId]?.[varianteId];
  if (zeitStufen) {
    const ziel = zeitStufen.find((stufe: ZeitStufe) => stufe.punkte === aktuellePunkte + 1);
    return ziel ? { punkte: ziel.punkte, bisSekunden: ziel.bisSekunden } : null;
  }

  if (disziplinId === 'lsp-kugelstossen') {
    const tabelle = KUGEL_TABELLE[varianteId];
    if (!tabelle) {
      return null;
    }
    if (aktuellePunkte === 0) {
      return { punkte: 1, abCm: tabelle.mindestCm };
    }
    const vorstufe = tabelle.stufen.find((stufe: { punkte: number; bisCm: number }) => stufe.punkte === aktuellePunkte);
    return vorstufe ? { punkte: aktuellePunkte + 1, abCm: vorstufe.bisCm + 1 } : null;
  }

  return null;
}

// Wertung einer einzelnen Disziplin. `ergebnis` ist der gespeicherte Draft bzw. der
// entsprechende Ausschnitt daraus: { totalMs, measuredCm, judgePoints, nullwertungIds }.
// Eine angehakte Nullwertung sticht jede errechnete Punktzahl.
export interface LspErgebnis {
  totalMs?: number | null;
  measuredCm?: number | null;
  judgePoints?: number | null;
  nullwertungIds?: string[];
}

export type LspBasis =
  | { art: 'zeit'; sekunden: number }
  | { art: 'weite'; zentimeter: number }
  | { art: 'bewertung'; punkte: number };

export interface LspDisziplinWertung {
  disziplinId: string;
  kind: LspKind;
  punkte: number | null;
  basis: LspBasis | null;
  nullwertung: boolean;
  gruende: string[];
}

export function computeLspDisziplin(
  disziplinId: string,
  varianteId: string,
  ergebnis: LspErgebnis | null | undefined,
): LspDisziplinWertung | null {
  const disziplin = getLspDisziplin(disziplinId);
  if (!disziplin) {
    return null;
  }

  const angehakt = Array.isArray(ergebnis?.nullwertungIds) ? ergebnis.nullwertungIds : [];
  const gruende = disziplin.nullwertungen
    .filter((nullwertung) => angehakt.includes(nullwertung.id))
    .map((nullwertung) => nullwertung.label);

  let punkte: number | null = null;
  let basis: LspBasis | null = null;

  if (disziplin.kind === 'timed') {
    const totalMs = typeof ergebnis?.totalMs === 'number' ? ergebnis.totalMs : 0;
    if (totalMs > 0) {
      basis = { art: 'zeit', sekunden: totalMs / 1000 };
      punkte = punkteFuerZeit(disziplinId, varianteId, totalMs / 1000);
    }
  } else if (disziplin.kind === 'measured') {
    const zentimeter = typeof ergebnis?.measuredCm === 'number' ? ergebnis.measuredCm : null;
    if (zentimeter !== null && zentimeter > 0) {
      basis = { art: 'weite', zentimeter };
      punkte = punkteFuerWeite(varianteId, zentimeter);
    }
  } else {
    const bewertung = ergebnis?.judgePoints;
    if (typeof bewertung === 'number' && bewertung >= 0 && bewertung <= 4) {
      basis = { art: 'bewertung', punkte: bewertung };
      punkte = bewertung;
    }
  }

  if (gruende.length > 0) {
    punkte = 0;
  }

  return {
    disziplinId,
    kind: disziplin.kind,
    punkte,
    basis,
    nullwertung: gruende.length > 0 || punkte === 0,
    gruende
  };
}

function mittelwert(werte: unknown[]): number | null {
  const gueltige = werte.filter((wert): wert is number => typeof wert === 'number' && wert >= 0 && wert <= 4);
  if (gueltige.length === 0) {
    return null;
  }
  const summe = gueltige.reduce((total, wert) => total + wert, 0);
  return Math.round((summe / gueltige.length) * 10) / 10;
}

// Gesamtwertung nach [R] 4.5 e und 4.6.
//
// `disziplinPunkte` ist eine Map { [disziplinId]: punkte | null }, `gesamteindruck`
// ein Array mit den fünf Einzelbeurteilungen (jeweils 0–4 oder null).
//
// Die Gesamtpunktzahl ist die Summe der fünf Übungspunkte plus dem Durchschnitt des
// Gesamteindrucks. Mindestens 10 Punkte sind zu erreichen.
export function computeLspGesamt(
  disziplinPunkte: Record<string, number | null | undefined> | null | undefined,
  gesamteindruck: (number | null)[] | null | undefined,
) {
  const punkteJeDisziplin = LSP_DISZIPLIN_IDS.map((id) => {
    const wert = disziplinPunkte?.[id];
    return typeof wert === 'number' ? wert : null;
  });

  const bewertet = punkteJeDisziplin.filter((wert) => wert !== null);
  const vollstaendig = bewertet.length === LSP_DISZIPLIN_IDS.length;
  const uebungsSumme = bewertet.reduce((total, wert) => total + wert, 0);

  const gesamteindruckWerte = Array.isArray(gesamteindruck) ? gesamteindruck : [];
  const gesamteindruckDurchschnitt = mittelwert(gesamteindruckWerte);
  const summe = Math.round((uebungsSumme + (gesamteindruckDurchschnitt ?? 0)) * 10) / 10;

  const nullDisziplinen = LSP_DISZIPLIN_IDS.filter((id) => disziplinPunkte?.[id] === 0);
  const nullNichtWiederholbar = nullDisziplinen.filter((id) => !getLspDisziplin(id)?.wiederholbar);
  const nullWiederholbar = nullDisziplinen.filter((id) => getLspDisziplin(id)?.wiederholbar);

  const ausscheidegruende = [];
  if (vollstaendig && gesamteindruckDurchschnitt !== null && summe < LSP_MINDESTPUNKTE) {
    ausscheidegruende.push(`Weniger als ${LSP_MINDESTPUNKTE} Gesamtpunkte erreicht.`);
  }
  if (gesamteindruckDurchschnitt !== null && gesamteindruckDurchschnitt < 1) {
    ausscheidegruende.push('Der Gesamteindruck ist mangelhaft.');
  }
  for (const id of nullNichtWiederholbar) {
    ausscheidegruende.push(`0-Wertung in der Disziplin „${getLspDisziplin(id)?.label}".`);
  }
  if (nullDisziplinen.length > 1) {
    ausscheidegruende.push('Mehr als eine 0-Wertung.');
  }

  // [R] 4.6.5 — eine 0-Wertung in Schnelligkeitsübung, Staffellauf oder Kugelstoßen
  // darf einmal wiederholt werden, sofern insgesamt 10 Punkte erreicht wurden.
  const wiederholungMoeglich =
    ausscheidegruende.length === 0
    && nullWiederholbar.length === 1
    && summe >= LSP_MINDESTPUNKTE;

  return {
    punkteJeDisziplin,
    uebungsSumme,
    gesamteindruckDurchschnitt,
    summe,
    vollstaendig: vollstaendig && gesamteindruckDurchschnitt !== null,
    nullDisziplinen,
    ausgeschieden: ausscheidegruende.length > 0,
    ausscheidegruende,
    wiederholungMoeglich,
    bestanden:
      vollstaendig
      && gesamteindruckDurchschnitt !== null
      && ausscheidegruende.length === 0
      && nullDisziplinen.length === 0
      && summe >= LSP_MINDESTPUNKTE
  };
}
