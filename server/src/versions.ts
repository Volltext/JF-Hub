/**
 * Schnittstelle dieses Servers (steigt bei Änderungen, die ältere Apps nicht verstehen) und das kleinste Dokumentformat
 * (`X-JFH-Schema` der App), das er noch annimmt. Apps ohne Angabe (2.0.x) gelten als Schema 1.
 *
 * Schema 1 = 2.0.x · 2 = 2.1.0 · 3 = 2.2.0 (Anhänge als Blobs) · 4 = 2.3.0 (Tabellen, Links, Markierung) · 5 = 3.0.0 (Text als Yjs-Dokument).
 * Seit 3.0.0 nimmt der Server nur noch Schema 5 an: Der Text wird nicht mehr im Abgleich der Protokolle übertragen, und eine App mit
 * dem alten Ablauf würde Protokolle mit leerem Text anlegen oder überschreiben.
 *
 * Seit die Texte der Protokolle gemeinsam bearbeitet werden (Yjs), gilt eine feste Regel: Wer das Vokabular des Editors ändert
 * (Knoten, Markierungen oder Attribute), erhöht im selben Release `API_VERSION` und `MIN_SCHEMA` hier sowie `SCHEMA_VERSION` und
 * `MIN_SERVER_API` in der App. Ein Client mit anderem Vokabular würde im geteilten Dokument löschen, was er nicht kennt.
 */
export const API_VERSION = 4;
export const MIN_SCHEMA = 5;
