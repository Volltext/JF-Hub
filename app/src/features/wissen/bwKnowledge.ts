import type { KnotGuide, PositionGuide, RuleEntry } from './types';

export const RULE_ENTRIES: RuleEntry[] = [
  {
    id: 'rule-b-coupling',
    title: 'Kuppeln B-Schlauch',
    category: 'Ablaufregel',
    keywords: ['kuppeln', 'b-schlauch', 'wassertrupp', 'schlauchtrupp'],
    summary: 'Das Kuppeln des B-Schlauchs darf nur von Wassertrupp und Schlauchtrupp durchgeführt werden. Der Melder darf nicht helfen.',
    details: [
      'Diese Regel sollte in der Rollenbesprechung vor dem Lauf klar wiederholt werden.',
      'Bei Fehlern lohnt sich ein Blick auf Rollenverständnis und Positionstreue.'
    ]
  },
  {
    id: 'rule-b-baton',
    title: 'B-Teil: Staffelholz',
    category: 'Ablaufregel',
    keywords: ['b-teil', 'staffelholz', 'wechselraum'],
    summary: 'Das Staffelholz muss innerhalb des Wechselraums übergeben werden. Werfen ist verboten.',
    details: [
      'Im Training hilft ein klarer visueller Wechselpunkt für jedes Team.',
      'Die Sonderzeiten im B-Teil sollten nur Aufgaben messen, nicht regelwidrige Übergaben kaschieren.'
    ]
  },
  {
    id: 'ateil-start',
    title: 'A-Teil: Der Start',
    category: 'Ablaufbeschreibung',
    keywords: ['start', 'einsatzbefehl', 'aufstellung', 'ts', 'unterflurhydrant', 'verteiler', 'leiterwand'],
    summary: 'Die Gruppe nimmt zwischen der TS und dem Ablageplatz Aufstellung. Der GF erteilt den Einsatzbefehl.',
    details: [
      'Die Gruppe stellt sich zwischen der Tragkraftspritze (TS) und dem Ablageplatz auf.',
      'Der GF steht vor der Gruppe und gibt den Einsatzbefehl: Wasserentnahme aus dem Unterflurhydranten, Positionierung des Verteilers.',
      'Zusätzlich erteilt der GF dem Angriffstrupp den Befehl für das 1. Rohr über die Leiterwand.'
    ]
  },
  {
    id: 'ateil-rohr-1',
    title: 'A-Teil: 1. Rohr – Aufgaben aller Trupps',
    category: 'Ablaufbeschreibung',
    keywords: ['angriffstrupp', 'atf', 'atm', 'wassertrupp', 'wtf', 'wtm', 'schlauchtrupp', 'stf', 'stm', 'melder', 'maschinist', 'leiterwand', 'verteiler', 'c-schlauch'],
    summary: 'Alle Trupps führen gleichzeitig ihre Aufgabe aus: AT baut das 1. Rohr auf, WT stellt Wasserversorgung her, ST bringt Material zum Verteiler.',
    details: [
      'AT (ATF+ATM): ATF wiederholt Befehl, holt Handscheinwerfer und Verteiler. ATM nimmt CM-Strahlrohr und zwei C-Schläuche. Handscheinwerfer wird an der 40-m-Linie abgestellt. C-Schlauchleitung wird unter der Leiterwand verlegt, AT klettert darüber. Erster Schlauch ohne Verdrehung, zweiter als Reserve. Nach Ankuppeln: "1. Rohr Wasser marsch!"',
      'GF & Melder: Rüsten sich mit Handscheinwerfern aus und begeben sich in die Nähe des Verteilers.',
      'Maschinist: Holt Sammelstück und Kupplungsschlüssel, macht TS betriebsbereit, kuppelt Sammelstück und B-Schläuche an. Bei Kommando "Wasser marsch!" öffnet er den Druckabgang.',
      'WT (WTF+WTM): Setzt Standrohr, öffnet Unterflurhydranten (mind. 2 Umdrehungen) und spült. Verlegt B-Schlauch von TS zu Standrohr und kuppelt ihn an. Zweiten B-Schlauch ohne Verdrehung durch den Wassergraben bis Verteiler verlegen. Nach Ankuppeln: WTF gibt MA das Kommando "Wasser marsch!" und meldet sich beim GF mit "Wassertrupp einsatzbereit".',
      'ST (STF+STM): Nimmt vier C-Schläuche auf und bringt sie zur Verteilerposition. STF bedient den Verteiler, STM bleibt beim STF.'
    ]
  },
  {
    id: 'ateil-rohr-2',
    title: 'A-Teil: 2. Rohr – Wassertrupp & Schlauchtrupp',
    category: 'Ablaufbeschreibung',
    keywords: ['2. rohr', 'wassertrupp', 'wtf', 'wtm', 'schlauchtrupp', 'stf', 'stm', 'hurde', 'verteiler', 'c-schlauch'],
    summary: 'GF befiehlt WT den Angriff auf den rechten Brandabschnitt über die Hürde. ST unterstützt mit Schlauchmaterial.',
    details: [
      'GF: Befiehlt dem Wassertrupp den Angriff auf den rechten Brandabschnitt über die Hürde.',
      'WT: WTF wiederholt Befehl, rüstet sich aus. WTF nimmt Handscheinwerfer, WTM das CM-Strahlrohr. Beide gehen über die Hürde zur 40-m-Linie, stellen Handscheinwerfer ab und erwarten den ST. Nach Ausrollen der Schlauchreserve kuppelt WT das Strahlrohr an, WTF befiehlt "2. Rohr Wasser marsch!" und öffnet das Rohr.',
      'ST: Nimmt zwei C-Schläuche auf und geht über die Hürde zum WT. Nach Kommando verlegt ST die Leitung unter der Hürde hindurch zum Verteiler. Erster Schlauch ohne Verdrehung, zweiter als Reserve. STF kuppelt am Verteiler an und öffnet den Druckabgang. STM bleibt beim STF.'
    ]
  },
  {
    id: 'ateil-rohr-3',
    title: 'A-Teil: 3. Rohr – Schlauchtrupp & Melder',
    category: 'Ablaufbeschreibung',
    keywords: ['3. rohr', 'schlauchtrupp', 'stf', 'stm', 'melder', 'kriechtunnel', 'verteiler', 'c-schlauch'],
    summary: 'GF befiehlt ST den Angriff durch den Kriechtunnel und überträgt dem Melder den Verteiler.',
    details: [
      'GF: Befiehlt dem ST den Angriff auf den mittleren Brandabschnitt durch den Kriechtunnel. Danach erteilt der GF dem Melder: "Melder übernimmt Verteiler".',
      'ST: STF wiederholt Befehl, rüstet sich aus. STF nimmt Handscheinwerfer, STM das CM-Strahlrohr. Am Verteiler nehmen sie zwei C-Schläuche auf und verlegen die Leitung vom Verteiler durch den Kriechtunnel. Erster Schlauch ohne Verdrehung, zweiter als Reserve. STF kuppelt an, befiehlt "3. Rohr Wasser marsch!" und öffnet das Rohr. Handscheinwerfer bleibt an der 40-m-Linie.',
      'Melder: Wiederholt Befehl, übernimmt Verteiler und C-Schlauch-Kupplung vom ST und bedient den Verteiler ab sofort.'
    ]
  },
  {
    id: 'ateil-ende',
    title: 'A-Teil: Knoten & Übungsende',
    category: 'Ablaufbeschreibung',
    keywords: ['wasser halt', 'knoten', 'kreuzknoten', 'zimmermannsschlag', 'mastwurf', 'schotenstich', 'uebungsende', 'knotengestell'],
    summary: 'Nach "Wasser halt!" fertigen GF, AT und WT am Knotengestell vier Knoten auf Zeit an. Abschluss mit Meldung "Übung beendet!".',
    details: [
      '"Wasser halt!": GF gibt den Befehl, nachdem alle Trupps ihre Aufgaben erfüllt haben.',
      'Rückmeldung: ATF, WTF, STF melden nacheinander "1./2./3. Rohr Wasser halt!", schließen ihr Strahlrohr und legen es ab. AT und WT bleiben an der 40-m-Linie, ST bleibt ebenfalls stehen. Melder schließt nach den Rückmeldungen den Verteiler.',
      'Knoten: GF befiehlt "Angriffstrupp und Wassertrupp Knoten und Stiche anlegen!" GF geht mit Handscheinwerfer durch den Kriechtunnel zum Knotengestell. AT und WT fertigen vier Knoten auf Zeit: Kreuzknoten, Zimmermannsschlag, Mastwurf, Schotenstich.',
      'Übungsende: GF, AT und WT treten vor dem Knotengestell mit Blickrichtung zur TS an. GF meldet dem Bahnleiter "Übung beendet!"'
    ]
  }
];

export const POSITION_GUIDES: PositionGuide[] = [
  {
    id: 'a-gruppenfuehrer',
    title: 'Gruppenführer',
    shortLabel: 'GF',
    section: 'A-Teil',
    duties: [
      'Zwischen TS und Ablageplatz aufstellen lassen und den Einsatzbefehl zur Wasserentnahme aus dem Unterflurhydranten geben.',
      'Verteilerposition anweisen und dem Angriffstrupp den Befehl für das 1. Rohr über die Leiterwand erteilen.',
      'Für 2. und 3. Rohr die Folgekommandos geben (WT über Hürde, ST durch Kriechtunnel, Melder übernimmt Verteiler).',
      'Nach "Wasser halt!" den Knotenbefehl geben und am Ende mit GF/AT/WT vor dem Knotengestell "Übung beendet!" melden.'
    ],
    watchouts: ['Unklares Kommando', 'Zu späte Korrektur', 'Fehlende Übersicht auf beide Trupps']
  },
  {
    id: 'a-melder',
    title: 'Melder',
    shortLabel: 'Me',
    section: 'A-Teil',
    duties: [
      'Sich wie der GF mit Handscheinwerfer ausrüsten und in der Nähe des Verteilers bereithalten.',
      'Keine unzulässigen Truppaufgaben übernehmen (insbesondere nicht beim Kuppeln des B-Schlauchs helfen).',
      'Nach Befehl "Melder übernimmt Verteiler" die C-Schlauch-Kupplung vom ST übernehmen und am Verteiler kuppeln.',
      'Nach den Rückmeldungen "1./2./3. Rohr Wasser halt!" den Verteiler schließen.'
    ],
    watchouts: ['Hilft unzulässig beim Kuppeln', 'Verpasst Kommandos', 'Läuft in Truppwege']
  },
  {
    id: 'a-maschinist',
    title: 'Maschinist',
    shortLabel: 'Ma',
    section: 'A-Teil',
    duties: [
      'Sammelstück und Kupplungsschlüssel vom Ablageplatz holen, TS betriebsbereit machen und Sammelstück sowie B-Schläuche kuppeln.',
      'Auf das Kommando "Wasser marsch!" des WTF den Druckabgang der TS öffnen.',
      'Die Wasserförderung stabil halten, bis der Befehl "Wasser halt!" erfolgt.',
      'Keine Tätigkeiten anderer Trupps übernehmen und den Pumpenbereich geordnet halten.'
    ],
    watchouts: ['Zu später Wasseraufbau', 'Fehlerhafte Bedienfolge', 'Keine Rückmeldung an GF']
  },
  {
    id: 'a-angriffstruppfuehrer',
    title: 'Angriffstruppführer',
    shortLabel: 'ATF',
    section: 'A-Teil',
    duties: [
      'Befehl des GF wiederholen, Handscheinwerfer und Verteiler aufnehmen und bis zur 40-m-Linie mitführen.',
      'Handscheinwerfer an der 40-m-Linie abstellen, ersten C-Schlauch am Verteiler kuppeln und die Leitung unter der Leiterwand zum linken Brandabschnitt führen.',
      'Sicherstellen, dass erster Schlauch ohne Verdrehung und zweiter als komplette Reserve liegt.',
      'Nach dem Ankuppeln des Strahlrohrs "1. Rohr Wasser marsch!" befehlen und das Strahlrohr öffnen.'
    ],
    watchouts: ['Schlechter Laufweg', 'Unsaubere Truppabstimmung', 'Zu frühes oder zu spätes Arbeiten am Ziel']
  },
  {
    id: 'a-angriffstruppmann',
    title: 'Angriffstruppmann',
    shortLabel: 'ATM',
    section: 'A-Teil',
    duties: [
      'CM-Strahlrohr und zwei doppelt gerollte C-Schläuche aufnehmen und mit dem ATF bis zur 40-m-Linie führen.',
      'Leitung unter der Leiterwand verlegen und das Strahlrohr am linken Brandabschnitt ankuppeln.',
      'Nach "Wasser halt!" am Knotengestell die vorgegebenen vier Knoten auf Zeit sauber anlegen.',
      'Nach Knotenabschluss mit GF/WT vor dem Knotengestell antreten.'
    ],
    watchouts: ['Falscher Knoten', 'Zu lange am Knotengestell', 'Verzögerter Wiedereinstieg in den Ablauf']
  },
  {
    id: 'a-wassertruppfuehrer',
    title: 'Wassertruppführer',
    shortLabel: 'WTF',
    section: 'A-Teil',
    duties: [
      'Standrohr setzen, Unterflurhydrant mindestens zwei Umdrehungen öffnen und spülen.',
      'Wasserversorgung von TS über Standrohr bis zum Verteiler mit dem WTM herstellen und den zweiten B-Schlauch ohne Verdrehung durch den Wassergraben verlegen.',
      'Nach dem Kuppeln am Verteiler dem MA das Kommando "Wasser marsch!" geben und dem GF "Wassertrupp einsatzbereit" melden.',
      'Beim 2. Rohr den WT über die Hürde führen, nach Ankuppeln "2. Rohr Wasser marsch!" befehlen und das Rohr öffnen.'
    ],
    watchouts: ['Kuppelfehler', 'Schläuche liegen im Laufweg', 'Fehlende Rückmeldung']
  },
  {
    id: 'a-wassertruppmann',
    title: 'Wassertruppmann',
    shortLabel: 'WTM',
    section: 'A-Teil',
    duties: [
      'WTF bei Standrohr, Hydrant und B-Schlauch-Verlegung aktiv unterstützen und alle Kupplungen dicht setzen.',
      'Beim 2. Rohr das CM-Strahlrohr aufnehmen, über die Hürde zur 40-m-Linie gehen und nach Ausrollen der Reserve ankuppeln.',
      'Nach "Wasser halt!" die Knotenaufgabe am Knotengestell mit dem AT auf Zeit ausführen.',
      'Nach Abschluss geordnet antreten und auf weitere Befehle warten.'
    ],
    watchouts: ['Unsichere Kupplung', 'Zeitverlust durch Nacharbeiten', 'Knoten nicht belastbar']
  },
  {
    id: 'a-schlauchtruppfuehrer',
    title: 'Schlauchtruppführer',
    shortLabel: 'STF',
    section: 'A-Teil',
    duties: [
      'Nach Wiederholung des AT-Befehls vier doppelt gerollte C-Schläuche zur markierten Verteilerstelle bringen.',
      'Den Verteiler bedienen und nach Kommando des ATF den Abgang für das 1. Rohr öffnen.',
      'Beim 2. Rohr mit dem STM zwei C-Schläuche über die Hürde zum WT bringen, Leitung unter der Hürde zum Verteiler verlegen und den Abgang öffnen.',
      'Beim 3. Rohr durch den Kriechtunnel zum mittleren Brandabschnitt vorgehen, "3. Rohr Wasser marsch!" befehlen und das Strahlrohr öffnen.'
    ],
    watchouts: ['Verdrillter Schlauch', 'Falsche Positionierung', 'Blockiert andere Truppwege']
  },
  {
    id: 'a-schlauchtruppmann',
    title: 'Schlauchtruppmann',
    shortLabel: 'STM',
    section: 'A-Teil',
    duties: [
      'Mit dem STF Schlauchmaterial aufnehmen, geordnet verlegen und den Verteilerbereich freihalten.',
      'Beim 1. und 2. Rohr beim STF am Verteiler bleiben und den Abschnitt absichern.',
      'Beim 3. Rohr das CM-Strahlrohr aufnehmen, durch den Kriechtunnel vorgehen und die Leitung ohne Verdrehung mit Reserve verlegen.',
      'Nach "Wasser halt!" am zugewiesenen Standort stehen bleiben und auf Abschlusskommando warten.'
    ],
    watchouts: ['Falscher Knoten', 'Lose Kupplung', 'Schlauch bleibt im Laufweg']
  },
  {
    id: 'b-laeufer-1',
    title: 'Läufer 1',
    shortLabel: 'L1',
    section: 'B-Teil',
    duties: [
      'Startsignal aufnehmen und explosiv, aber kontrolliert anlaufen.',
      'Staffelholz sicher in der Handhaltung für die Übergabe führen.',
      'An Läufer 2 nur innerhalb des Wechselraums übergeben.'
    ],
    watchouts: ['Zu hektischer Start', 'Unsicheres Staffelholz', 'Übergabe außerhalb Wechselraum']
  },
  {
    id: 'b-laeufer-2',
    title: 'Läufer 2',
    shortLabel: 'L2',
    section: 'B-Teil',
    duties: [
      'Übergabe von L1 im Wechselraum sauber annehmen.',
      'Lauftempo stabil halten und den Wechsel auf L3 vorbereiten.',
      'Staffelholz mit klarer Handführung weitergeben.'
    ],
    watchouts: ['Stockender Wechsel', 'Unklare Handführung', 'Tempoeinbruch vor Wechsel']
  },
  {
    id: 'b-laeufer-3',
    title: 'Läufer 3',
    shortLabel: 'L3',
    section: 'B-Teil',
    duties: [
      'Staffelholz im Wechselraum übernehmen.',
      'Die Ausrüstungsaufgabe vollständig und korrekt durchführen.',
      'Nach Abschluss direkt wieder in den Laufrhythmus kommen und an L4 übergeben.'
    ],
    watchouts: ['Ausrüstung nicht komplett', 'Zeitverlust bei Teilaufgaben', 'Unsicherer Wiedereinstieg']
  },
  {
    id: 'b-laeufer-4',
    title: 'Läufer 4',
    shortLabel: 'L4',
    section: 'B-Teil',
    duties: [
      'Übergabe von L3 aufnehmen und Lauf stabilisieren.',
      'Konstanten Rhythmus halten, damit der Aufgabenverlust ausgeglichen wird.',
      'Saubere Übergabe auf L5 im Wechselraum.'
    ],
    watchouts: ['Überzieht Tempo', 'Unscharfer Wechselpunkt', 'Verliert Staffelrhythmus']
  },
  {
    id: 'b-laeufer-5',
    title: 'Läufer 5',
    shortLabel: 'L5',
    section: 'B-Teil',
    duties: [
      'Übergabe auf gerader Linie annehmen.',
      'Lauf ohne Positionsverlust halten und auf L6 vorbereiten.',
      'Staffelholz sicher und regelkonform übergeben.'
    ],
    watchouts: ['Übergabegriff unsicher', 'Seitliches Ausbrechen', 'Abfallendes Tempo']
  },
  {
    id: 'b-laeufer-6',
    title: 'Läufer 6',
    shortLabel: 'L6',
    section: 'B-Teil',
    duties: [
      'Laufstrecke sauber übernehmen und auf L7 zuführen.',
      'Staffelholz in guter Position für die Aufgabenphase übergeben.',
      'Wechsel exakt im markierten Bereich halten.'
    ],
    watchouts: ['Unsauberer Anlauf in Wechselzone', 'Hektische Übergabe', 'Zu späte Staffelholzfreigabe']
  },
  {
    id: 'b-laeufer-7',
    title: 'Läufer 7',
    shortLabel: 'L7',
    section: 'B-Teil',
    duties: [
      'Übergabe aufnehmen und direkt zur Knotenaufgabe gehen.',
      'Vorgegebenen Knoten vollständig und korrekt herstellen.',
      'Nach Knotenabschluss Staffelholz sicher an L8 weitergeben.'
    ],
    watchouts: ['Knoten nicht korrekt', 'Zu lange Knotenzeit', 'Unsicherer Wechsel nach Aufgabe']
  },
  {
    id: 'b-laeufer-8',
    title: 'Läufer 8',
    shortLabel: 'L8',
    section: 'B-Teil',
    duties: [
      'Staffelholz übernehmen und Schlauchrolle-Aufgabe ausführen.',
      'Schlauch sauber und regelkonform rollen, ohne Nacharbeiten.',
      'Nach Aufgabenende sofort an L9 übergeben.'
    ],
    watchouts: ['Unsaubere Schlauchrolle', 'Nachfassen kostet Zeit', 'Verspäteter Wechsel auf L9']
  },
  {
    id: 'b-laeufer-9',
    title: 'Läufer 9',
    shortLabel: 'L9',
    section: 'B-Teil',
    duties: [
      'Letzte Übergabe im Wechselraum sicher annehmen.',
      'Zielstrecke mit sauberer Lauftechnik bis zur Ziellinie durchziehen.',
      'Lauf regelkonform abschließen und Staffelholz kontrolliert sichern.'
    ],
    watchouts: ['Übernahmefehler im letzten Wechsel', 'Zu früher Endspurt', 'Unsicherer Zielabschluss']
  }
];

export const KNOT_GUIDES: KnotGuide[] = [
  {
    id: 'mastwurf',
    title: 'Mastwurf',
    category: 'Knoten',
    steps: [
      'Eine Bucht bilden.',
      'Eine zweite Bucht gegenläufig anlegen.',
      'Beide Buchten übereinanderlegen und über das Zielobjekt stülpen.',
      'Sitz kontrollieren und Lastprobe machen.'
    ]
  },
  {
    id: 'kreuzknoten',
    title: 'Kreuzknoten',
    category: 'Knoten',
    steps: [
      'Rechtes Ende über linkes Ende legen und durchziehen.',
      'Danach linkes Ende über rechtes Ende legen und erneut durchziehen.',
      'Darauf achten, dass beide Enden parallel sauber austreten.'
    ]
  },
  {
    id: 'zimmermannsschlag',
    title: 'Zimmermannsschlag',
    category: 'Knoten',
    steps: [
      'Leine um das Objekt führen.',
      'Lose Part mehrfach um die stehende Part wickeln.',
      'Zuziehen und auf festen Sitz prüfen.'
    ]
  },
  {
    id: 'schotenstich',
    title: 'Schotenstich',
    category: 'Knoten',
    steps: [
      'Mit dem stärkeren Ende eine Bucht legen.',
      'Das lose Ende von unten durch die Bucht führen.',
      'Hinter beiden Parten entlang und unter sich selbst durchziehen.',
      'Sauber festziehen und kontrollieren.'
    ]
  }
];
