/**
 * Stand des Dokumentformats, den diese App-Version versteht (Knoten und Markierungen des Editors). Er steigt, wenn neue Elemente
 * dazukommen. Jede Anfrage meldet ihn dem Server (`X-JFH-Schema`); verlangt der Server ein höheres Mindest-Schema, weist er die App
 * ab („Bitte die App aktualisieren“), statt dass sie Inhalte, die sie nicht kennt, stillschweigend verwirft und überschreibt.
 *
 *   1 = Version 2.0.x (ohne Meldung)
 *   2 = 2.1.0: meldet sich beim Server, schützt unbekannte Inhalte vor dem Überschreiben, reicht `blobId` durch
 *   3 = 2.2.x: Fotos und Dateien liegen als Anhänge (`blobId`) auf dem Server und werden angezeigt
 *   4 = 2.3.0: Tabellen, Links und Hervorhebung. Ältere Apps lesen solche Protokolle nur (kein Mindest-Schema nötig).
 *   5 = ab 3.0.0: Der Text liegt als Yjs-Dokument auf dem Server und wird zusammen bearbeitet. Der Server nimmt nur noch Apps ab Schema 5 an.
 *
 * Seit 3.0.0 gilt eine feste Regel: Wer das Vokabular des Editors ändert (Knoten, Markierungen oder Attribute), erhöht im selben Release
 * `SCHEMA_VERSION` und `MIN_SERVER_API` hier sowie `MIN_SCHEMA` und `API_VERSION` in `server/src/versions.ts`. Ein Client mit anderem
 * Vokabular würde im geteilten Dokument löschen, was er nicht kennt (`@tiptap/y-tiptap` entfernt Elemente, die es nicht bauen kann).
 * `editorSchema.test.ts` hält die Zahlen beider Seiten zusammen.
 */
export const SCHEMA_VERSION = 5;

/** Kleinste Server-Schnittstelle (`api` in `/api/status` und in der Abgleich-Antwort), mit der diese App-Version arbeitet. 3 = Anhänge, 4 = Text als Yjs-Dokument. */
export const MIN_SERVER_API = 4;
