// Wissensinhalte zur Leistungsspange der Deutschen Jugendfeuerwehr.
//
// QUELLEN: DJF-„Richtlinien zum Erwerb der Leistungsspange" [R] und
// DJF-„Erläuterungen zur bundeseinheitlichen Durchführung und Bewertung" [E],
// beide Stand 01.01.2024.
//
// Die Shapes entsprechen bewusst denen in `knowledge.js`, damit die
// Wissensdatenbank beide Wettbewerbe mit derselben Darstellung ausgeben kann.

import type { PositionGuide, RuleEntry } from './types';
import { LSP_GRUPPE_POSITIONS, LSP_STAFFEL_POSITIONS } from '@/features/wettkampf/rules/positions';

export const LSP_RULE_ENTRIES: RuleEntry[] = [
  {
    id: 'lsp-teilnahme',
    title: 'Wer darf antreten?',
    category: 'Bedingung',
    keywords: ['alter', 'teilnahme', 'ausweis', 'bewerber'],
    summary: 'Bewerberinnen und Bewerber von 15 bis 18 Jahren, mindestens ein Jahr in der Jugendfeuerwehr.',
    details: [
      'Maßgebend sind die Geburtsjahrgänge, die in der ersten LAUFFEUER-Ausgabe eines Jahres bekanntgegeben werden. Stichtag für die Alterseinstufung ist der 31. Dezember des laufenden Jahres.',
      'Die Bewerberinnen und Bewerber müssen sich mindestens ein Jahr in der Gemeinschaft einer Jugendfeuerwehr bewährt haben.',
      'Deutsche Bewerberinnen und Bewerber ohne gültigen DJF-Mitgliedsausweis können nicht teilnehmen.',
      'Die Einheit darf mit sogenannten Füllerinnen und Füllern zu einer Gruppe oder Staffel aufgefüllt werden. Diese sollten im geforderten Alter und nicht zu jung sein, damit die Leistungen erbracht werden können.'
    ]
  },
  {
    id: 'lsp-bedingungen',
    title: 'Die fünf Bedingungen',
    category: 'Ablaufregel',
    keywords: ['disziplinen', 'übungen', 'bedingungen', 'überblick'],
    summary: 'Schnelligkeitsübung, Kugelstoßen, Staffellauf, Löschangriff und Fragenbeantwortung — alle an einem Tag.',
    details: [
      'Auslegen einer Schlauchleitung als Schnelligkeitsübung.',
      'Kugelstoßen.',
      'Staffellauf.',
      'Vortragen eines Löschangriffs.',
      'Beantwortung von Fragen.',
      'Alle fünf Übungen müssen an einem Tag erfüllt werden. Hinzu kommt der Gesamteindruck, der über alle Übungen hinweg beurteilt wird.'
    ]
  },
  {
    id: 'lsp-wertung',
    title: 'Wertungstabelle 0–4 Punkte',
    category: 'Wertung',
    keywords: ['punkte', 'tabelle', 'zeit', 'weite', 'bewertung'],
    summary: 'Bei Schnelligkeitsübung, Kugelstoßen und Staffellauf ist die Punkteskala den erzielten Werten fest zugeordnet.',
    details: [
      'Schnelligkeitsübung Gruppe: bis 55 s = 4, bis 60 s = 3, bis 65 s = 2, bis 75 s = 1, über 75 s = 0.',
      'Schnelligkeitsübung Staffel: bis 50 s = 4, bis 55 s = 3, bis 60 s = 2, bis 70 s = 1, über 70 s = 0.',
      'Kugelstoßen Gruppe: über 70 m = 4, bis 70 m = 3, bis 64 m = 2, bis 59 m = 1, unter 55 m = 0.',
      'Kugelstoßen Staffel: über 46 m = 4, bis 46 m = 3, bis 42 m = 2, bis 39 m = 1, unter 36 m = 0.',
      'Staffellauf Gruppe: bis 3:30 = 4, bis 3:45 = 3, bis 4:00 = 2, bis 4:15 = 1, über 4:15 = 0.',
      'Staffellauf Staffel: bis 2:20 = 4, bis 2:30 = 3, bis 2:40 = 2, bis 2:50 = 1, über 2:50 = 0.',
      'Löschangriff und Fragenbeantwortung werden von der jeweils zuständigen Wertungsrichterin bzw. dem Wertungsrichter mit 0 bis 4 Punkten bewertet.'
    ]
  },
  {
    id: 'lsp-gesamteindruck',
    title: 'Gesamteindruck',
    category: 'Wertung',
    keywords: ['gesamteindruck', 'auftreten', 'verhalten', 'durchschnitt'],
    summary: 'Alle fünf Wertungsrichter/-innen beurteilen den Gesamteindruck; der Durchschnitt zählt als eigene Punktzahl.',
    details: [
      'Bewertet wird nicht die Leistung, sondern das Verhalten der Einheit während der Übungen.',
      'Punktewertung: 0 = mangelhaft, 1 = genügend, 2 = befriedigend, 3 = gut, 4 = sehr gut.',
      'Der Durchschnittswert (Summe geteilt durch 5) wird als Punktzahl eingetragen und zu den fünf Übungspunkten addiert.',
      'Kriterien können sein: Wie geht die Einheit miteinander um? Wie steht und verhält sie sich beim Antreten? Wie meldet sich die Einheitsführerin bzw. der Einheitsführer? Wie verhalten sich die Mitglieder untereinander und während der Übung?'
    ]
  },
  {
    id: 'lsp-ausscheiden',
    title: 'Ausscheiden und Wiederholung',
    category: 'Wertung',
    keywords: ['ausscheiden', 'wiederholung', 'bestanden', 'null'],
    summary: 'Mindestens 10 Gesamtpunkte sind zu erreichen; eine 0-Wertung kann unter Umständen einmal wiederholt werden.',
    details: [
      'Die Einheit scheidet aus, wenn weniger als 10 Gesamtpunkte erreicht wurden.',
      'Die Einheit scheidet aus, wenn der Gesamteindruck mangelhaft ist.',
      'Die Einheit scheidet aus, wenn eine 0-Wertung beim Löschangriff oder der Fragenbeantwortung vorliegt.',
      'Die Einheit scheidet aus, wenn mehr als eine 0-Wertung vorliegt.',
      'Die Einheit scheidet aus, wenn eine 0-Wertung in Schnelligkeitsübung, Staffellauf oder Kugelstoßen auch nach der Wiederholung bestehen bleibt.',
      'Die Einheit scheidet aus, wenn sie betrogen hat — der Versuch reicht aus.',
      'Eine Wiederholung ist nur bei erreichten 10 Gesamtpunkten einschließlich Gesamteindruck einmal möglich und erst nach Absolvierung aller übrigen Disziplinen.',
      'Nach dem Ausscheiden kann die gesamte Abnahme erst nach vier Wochen wiederholt werden.'
    ]
  },
  {
    id: 'lsp-bekleidung',
    title: 'Bekleidung und Brusttücher',
    category: 'Ablaufregel',
    keywords: ['bekleidung', 'psa', 'helm', 'handschuhe', 'brusttuch', 'sportzeug'],
    summary: 'Feuerwehrtechnische Teile in DJF-Bekleidung mit Helm und Handschuhen, Kugelstoßen und Staffellauf in Sportzeug.',
    details: [
      'Die Einheiten treten in Bekleidung nach DJF-Bekleidungsrichtlinie mit Schutzhelm, Schutzhandschuhen und festem Schuhwerk an.',
      'Bei den feuerwehrtechnischen Übungsteilen sind die Schutzhandschuhe zu tragen.',
      'Kugelstoßen und Staffellauf werden in Sportzeug durchgeführt; Spikes- und Stollenschuhe sind nicht zulässig.',
      'Schnelligkeitsübung: Brusttücher mit den Nummern 1–8 bei der Gruppe, 1–5 bei der Staffel. Die Einheitsführerin bzw. der Einheitsführer trägt kein Brusttuch.',
      'Kugelstoßen und Staffellauf: Brusttücher mit den Nummern 1–9 bei der Gruppe, 1–6 bei der Staffel.',
      'Löschangriff: Brusttücher mit taktischen Zeichen.'
    ]
  },
  {
    id: 'lsp-schnelligkeit-ablauf',
    title: 'Schnelligkeitsübung: Ablauf',
    category: 'Ablaufbeschreibung',
    keywords: ['schnelligkeit', 'schlauch', 'kuppeln', 'festkupplung', '120 meter'],
    summary: 'Schlauchleitung aus doppelt gerolltem C-Druckschlauch über 120 m auslegen und kuppeln.',
    details: [
      'Die Übung stellt die Wasserförderung über eine lange Wegstrecke dar. Statt B-Druckschläuchen werden C-Druckschläuche verwendet, die von zwei Personen gekuppelt werden.',
      'Die Mitglieder nehmen links bzw. rechts der Festkupplung an der Startlinie hinter den C-Druckschläuchen Aufstellung, in Reihenfolge der Nummerierung.',
      'Die Einheitsführerin bzw. der Einheitsführer gibt das Startkommando „Auf die Plätze – fertig – los!".',
      'Jedes Mitglied verlegt seinen C-Druckschlauch und kuppelt an beiden Enden mit Vorgängerin bzw. Nachfolger. Der erste Schlauch wird an die Festkupplung angekuppelt.',
      'Die Übung endet an der Ziellinie in 120 m Entfernung, sobald die Einheit dort wieder in Linie zu einem Glied Aufstellung genommen hat — Meldung mit „Fertig!" und Handzeichen.',
      'Gruppe: 8 C-Druckschläuche, Maximalzeit 75 Sekunden. Staffel: 5 C-Druckschläuche, Maximalzeit 70 Sekunden.',
      'Tipp: Die Schläuche schon beim Ausrollen und Kuppeln möglichst verdrehungsfrei und gerade verlegen — das spart das spätere Ausrichten.'
    ]
  },
  {
    id: 'lsp-schnelligkeit-null',
    title: 'Schnelligkeitsübung: Nullwertungen',
    category: 'Nullwertung',
    keywords: ['nullwertung', 'schnelligkeit', 'kupplung', 'verdrehung'],
    summary: 'Vier Gründe führen zur 0-Wertung.',
    details: [
      'Zeitüberschreitung.',
      'Offenes Kupplungspaar.',
      'Verdrehung innerhalb eines Schlauches.',
      'Ein Mitglied hat nicht mit Vorgängerin bzw. Nachfolger laut laufender Nummerierung gekuppelt.'
    ]
  },
  {
    id: 'lsp-kugelstossen-ablauf',
    title: 'Kugelstoßen: Ablauf',
    category: 'Ablaufbeschreibung',
    keywords: ['kugelstoßen', 'weite', 'kugel', 'anlauf', 'markierungsleiste'],
    summary: 'Je ein Stoß aller Mitglieder; die Einzelweiten werden zur Gesamtweite addiert.',
    details: [
      'Jungen stoßen mit einer 4-kg-Kugel, Mädchen mit einer 3-kg-Kugel.',
      'Gruppe: 9 Stöße, Mindestweite 55 m gesamt. Staffel: 6 Stöße, Mindestweite 36 m gesamt.',
      'Grundform: Die nächste Person stößt jeweils ohne Anlauf (maximal zwei Schritte) von dort aus, wo die Kugel aufgetroffen ist. Die Wertungsrichterin bzw. der Wertungsrichter legt die Markierungsleiste auf den Auftreffpunkt.',
      'Alternative 1: Es wird immer von derselben Startlinie aus gestoßen, zwei Schritte Anlauf sind gestattet, die Weiten werden addiert.',
      'Alternative 2: Stoßen aus dem Kugelstoßkreis; gemessen wird von der Hinterkante des Auftreffpunkts bis zur Innenkante des Rings, das Maßband läuft durch den Mittelpunkt. Die Weiten werden addiert.',
      'Der Veranstalter teilt rechtzeitig mit, welche Methode angewendet wird.',
      'Die Markierungsleiste darf nicht verschoben, be- oder übertreten werden, solange die Kugel in der Luft ist — sonst ist der Stoß ungültig und die nächste Person stößt von derselben Linie.',
      'Tipp: Beim Anlauf zu den zwei Schritten etwas Abstand hinzugeben, um das Übertreten zu verhindern.'
    ]
  },
  {
    id: 'lsp-staffellauf-ablauf',
    title: 'Staffellauf: Ablauf',
    category: 'Ablaufbeschreibung',
    keywords: ['staffellauf', 'staffelstab', 'teilstrecke', '1500'],
    summary: 'Gruppe 1.500 m, Staffel 1.000 m in frei einzuteilenden Teilstrecken.',
    details: [
      'Alle 9 Mitglieder der Gruppe durchlaufen zusammen 1.500 m, alle 6 Mitglieder der Staffel 1.000 m.',
      'Die Teilstrecken sind frei einteilbar; die Läuferinnen und Läufer werden ihrer Leistungsfähigkeit entsprechend verteilt.',
      'Jedes Mitglied darf nur einmal eingesetzt werden. Bei jedem Wechsel ist der Staffelstab zu übergeben.',
      'Der letzte Läufer bzw. die letzte Läuferin muss den Staffelstab spätestens nach 4:15 (Gruppe) bzw. 2:50 (Staffel) durch das Ziel tragen.',
      'Die Art der Laufstrecke (400-m-Rundbahn oder Alternativstrecke) teilt der Veranstalter rechtzeitig mit.',
      'Tipp: Die fließende Staffelstabübergabe trainieren und die optimale Streckeneinteilung durch mehrere Probeläufe ermitteln.'
    ]
  },
  {
    id: 'lsp-staffellauf-null',
    title: 'Staffellauf: Nullwertungen',
    category: 'Nullwertung',
    keywords: ['nullwertung', 'staffellauf', 'fehlstart', 'behinderung'],
    summary: 'Sieben Gründe führen zur 0-Wertung.',
    details: [
      'Verlassen der Laufbahn durch eine Läuferin oder einen Läufer zur Erreichung eines Vorteils.',
      'Zeitüberschreitung.',
      'Nicht alle Mitglieder sind eingesetzt worden.',
      'Ein Mitglied wurde zweimal eingesetzt.',
      'Der Staffelstab erreicht die Ziellinie nicht.',
      'Dreimaliger Fehlstart.',
      'Behinderung einer anderen Läuferin oder eines anderen Läufers.'
    ]
  },
  {
    id: 'lsp-loeschangriff-ablauf',
    title: 'Löschangriff: Bedingungen',
    category: 'Ablaufbeschreibung',
    keywords: ['löschangriff', 'fwdv', 'saugschläuche', 'strahlrohr', 'tragkraftspritze'],
    summary: 'Schulungsmäßiger Löschangriff nach FwDV 3, ohne Wasserabgabe und ohne Bereitstellung.',
    details: [
      'Der Löschangriff wird ohne Wasserabgabe nach den zurzeit geltenden Feuerwehr-Dienstvorschriften durchgeführt.',
      'Ohne Bereitstellung.',
      'Wasserentnahme offenes Gewässer.',
      'Vier Saugschläuche.',
      'Doppelt gerollte C-Schläuche.',
      'Zügige Vornahme von 3 C-Rohren bei der Gruppe, 2 C-Rohren bei der Staffel.',
      'Das benötigte Gerät legt die Einheit vor Beginn selbstständig auf dem Ablageplatz neben der Tragkraftspritze bereit.',
      'Es werden keine besonderen Lagen angenommen und es fallen keine Kräfte aus.',
      'Als Trainingsgrundlage kann die Wettbewerbsordnung für den Bundeswettbewerb, Kapitel 4, unter Weglassen der Hindernisse genutzt werden. Die Staffel arbeitet sinngemäß nach FwDV 3.'
    ]
  },
  {
    id: 'lsp-loeschangriff-null',
    title: 'Löschangriff: Nullwertungen',
    category: 'Nullwertung',
    keywords: ['nullwertung', 'löschangriff', 'wasser', 'fwdv'],
    summary: 'Zwei Gründe führen zur 0-Wertung — mit besonders harter Folge.',
    details: [
      'Es besteht theoretisch nicht die Möglichkeit, an allen Strahlrohren Wasser abzugeben.',
      'Der Löschangriff wurde nicht nach den gültigen Feuerwehr-Dienstvorschriften vorgetragen.',
      'Bei einer 0-Wertung im Löschangriff ist die gesamte Abnahme erst nach vier Wochen wiederholbar.'
    ]
  },
  {
    id: 'lsp-fragen-ablauf',
    title: 'Fragenbeantwortung: Ablauf',
    category: 'Ablaufbeschreibung',
    keywords: ['fragen', 'wissen', 'gespräch', 'organisation', 'unfallverhütung'],
    summary: 'Ein etwa 15-minütiges Gespräch mit der ganzen Einheit unter Ausschluss der Öffentlichkeit.',
    details: [
      'Gefragt wird aus den Gebieten Organisation, Ausrüstung, Geräte, Löschmittel, Löschverfahren der Feuerwehr, Unfallverhütung sowie Gesellschafts- und Jugendpolitik.',
      'Bewertet wird das Wissen der gesamten Bewerbergruppe, nicht das einzelner Mitglieder.',
      'Die Einheit tritt in DJF-Bekleidung mit Helm an; der Helm kann bei der Beantwortung abgelegt werden.',
      'Herkunft und örtliche Gegebenheiten der Feuerwehr, von der die Bewerbergruppe kommt, sollen berücksichtigt werden.',
      'Fragenkataloge oder ähnliches haben hier keine Berechtigung.',
      'Bei einer 0-Wertung in der Fragenbeantwortung ist die gesamte Abnahme erst nach vier Wochen wiederholbar.'
    ]
  },
  {
    id: 'lsp-aufbau',
    title: 'Übungsbahnen und Geräte',
    category: 'Ablaufregel',
    keywords: ['aufbau', 'bahn', 'geräte', 'stoppuhr', 'maßband'],
    summary: 'Was der Veranstalter je Übungsbahn herrichten und bereitstellen muss.',
    details: [
      'Schnelligkeitsübung: Bahn von 130 m Länge und 12 m Breite, Start- und Ziellinie in 120 m Abstand, Festkupplung an der Startlinie, Markierungen alle 15 m. Benötigt: 8 C-Druckschläuche (Rollschläuche 15 m), 2 Stoppuhren.',
      'Kugelstoßen: abgesperrte Bahn von 80 m Länge und 6 m Breite mit Start- und Ziellinie in 55 m Abstand, oder 15 m Länge und 6 m Breite, oder eine Kugelstoßanlage. Benötigt: je eine 4-kg- und 3-kg-Kugel, 2 Holzlatten, 1 Maßband, ggf. 1 Harke.',
      'Staffellauf: Laufbahn von 1.500 m Länge mit Start- und Zieleinrichtungen. Benötigt: 1 Staffelstab, 2 Stoppuhren.',
      'Löschangriff: Bahn von 20 m Breite und 45 m Länge mit Markierung für den Standort der Tragkraftspritze.',
      'Fragenbeantwortung: geeigneter Unterrichtsraum oder Platz mit Sitzgelegenheiten für mindestens 10 Personen.'
    ]
  }
];

// Rollenbeschreibungen. Gruppe und Staffel teilen sich die Funktionen bis auf
// Melder/-in und Schlauchtrupp, deshalb werden die Texte einmal definiert und
// über die Positions-IDs auf beide Abschnitte verteilt.
const ROLLEN_TEXTE: Record<string, { duties: string[]; watchouts: string[] }> = {
  fuehrer: {
    duties: [
      'Führt die Einheit, ist an keinen Trupp gebunden und gibt alle Kommandos.',
      'Schnelligkeitsübung: gibt „Auf die Plätze – fertig – los!", zieht bei Bedarf die Schläuche gerade und meldet das Übungsende mit „Fertig!" und Handzeichen.',
      'Löschangriff: erkundet, gibt den Einsatzbefehl und überwacht den Aufbau nach FwDV 3.',
      'Meldet die Einheit beim Übungsleiter an und ab.'
    ],
    watchouts: [
      'Trägt bei der Schnelligkeitsübung kein Brusttuch — bei Kugelstoßen und Staffellauf dagegen schon.',
      'Der Gesamteindruck hängt stark davon ab, wie die Meldung und das Antreten wirken.',
      'Kommandos vollständig und in der richtigen Reihenfolge geben.'
    ]
  },
  maschinist: {
    duties: [
      'Bedient die Tragkraftspritze und stellt die Wasserversorgung sicher.',
      'Unterstützt beim Kuppeln der Saugleitung.',
      'Sichert die Einsatzstelle im Bereich der Pumpe.'
    ],
    watchouts: [
      'Der Löschangriff wird ohne Wasserabgabe vorgetragen — die Möglichkeit der Wasserabgabe muss aber theoretisch an allen Strahlrohren bestehen.',
      'Vier Saugschläuche sind vorgeschrieben.'
    ]
  },
  melder: {
    duties: [
      'Übermittelt Nachrichten und übernimmt besondere Aufgaben auf Befehl der Gruppenführung.',
      'Unterstützt dort, wo es der Aufbau erfordert.'
    ],
    watchouts: [
      'Die Staffel kennt keine Melderin und keinen Melder — die Funktion entfällt dort ersatzlos.'
    ]
  },
  angriffstrupp: {
    duties: [
      'Nimmt im Löschangriff das erste Rohr vor.',
      'Rüstet sich vollständig aus, bevor der Trupp vorgeht.'
    ],
    watchouts: [
      'Schutzhandschuhe sind bei den feuerwehrtechnischen Übungsteilen Pflicht.',
      'Doppelt gerollte C-Schläuche verwenden.'
    ]
  },
  wassertrupp: {
    duties: [
      'Stellt die Wasserversorgung von der Entnahmestelle zum Verteiler her.',
      'Kuppelt die Saugleitung und nimmt anschließend das zugewiesene Rohr vor.'
    ],
    watchouts: [
      'Wasserentnahme erfolgt am offenen Gewässer.',
      'Die Saugleitung wird gemeinsam gekuppelt — Absprache im Trupp entscheidet über das Tempo.'
    ]
  },
  schlauchtrupp: {
    duties: [
      'Verlegt die Schlauchleitungen und setzt den Verteiler.',
      'Nimmt im Löschangriff der Gruppe das dritte Rohr vor.'
    ],
    watchouts: [
      'Die Staffel hat keinen Schlauchtrupp und nimmt nur zwei C-Rohre vor.',
      'Auf verdrehungsfreie Leitungen achten.'
    ]
  }
};

const ROLLE_JE_POSITION: Record<string, string> = {
  'lsp-g-gruppenfuehrer': 'fuehrer',
  'lsp-g-melder': 'melder',
  'lsp-g-maschinist': 'maschinist',
  'lsp-g-angriffstruppfuehrer': 'angriffstrupp',
  'lsp-g-angriffstruppmann': 'angriffstrupp',
  'lsp-g-wassertruppfuehrer': 'wassertrupp',
  'lsp-g-wassertruppmann': 'wassertrupp',
  'lsp-g-schlauchtruppfuehrer': 'schlauchtrupp',
  'lsp-g-schlauchtruppmann': 'schlauchtrupp',
  'lsp-s-staffelfuehrer': 'fuehrer',
  'lsp-s-maschinist': 'maschinist',
  'lsp-s-angriffstruppfuehrer': 'angriffstrupp',
  'lsp-s-angriffstruppmann': 'angriffstrupp',
  'lsp-s-wassertruppfuehrer': 'wassertrupp',
  'lsp-s-wassertruppmann': 'wassertrupp'
};

// Die IDs entsprechen den Positions-IDs aus `domain.js` — das ist der Join-Key,
// über den die Aufstellung und die Wissensdatenbank zusammenfinden.
export const LSP_POSITION_GUIDES: PositionGuide[] = [...LSP_GRUPPE_POSITIONS, ...LSP_STAFFEL_POSITIONS].map((position) => {
  const texte = ROLLEN_TEXTE[ROLLE_JE_POSITION[position.id]!]!;
  return {
    id: position.id,
    title: position.label,
    shortLabel: position.shortLabel,
    section: position.section,
    duties: texte.duties,
    watchouts: texte.watchouts
  };
});
