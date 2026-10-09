/**
 * Schnittstelle dieses Servers (steigt bei Änderungen, die ältere Apps nicht verstehen) und das kleinste Dokumentformat
 * (`X-JFH-Schema` der App), das er noch annimmt. Apps ohne Angabe (2.0.x) gelten als Schema 1.
 *
 * Seit die Texte der Protokolle gemeinsam bearbeitet werden (Yjs), gilt eine feste Regel: Wer das Vokabular des Editors ändert
 * (Knoten, Markierungen oder Attribute), erhöht im selben Release `API_VERSION` und `MIN_SCHEMA` hier sowie `SCHEMA_VERSION` und
 * `MIN_SERVER_API` in der App. Ein Client mit anderem Vokabular würde im geteilten Dokument löschen, was er nicht kennt.
 */
export const API_VERSION = 3;
export const MIN_SCHEMA = 2;
