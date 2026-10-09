/**
 * Stand des Dokumentformats, den diese App-Version versteht (Knoten und Markierungen des Editors). Er steigt, wenn neue Elemente
 * dazukommen. Jede Anfrage meldet ihn dem Server (`X-JFH-Schema`); verlangt der Server ein höheres Mindest-Schema, weist er die App
 * ab („Bitte die App aktualisieren“), statt dass sie Inhalte, die sie nicht kennt, stillschweigend verwirft und überschreibt.
 *
 *   1 = Version 2.0.x (ohne Meldung)
 *   2 = 2.1.0: meldet sich beim Server, schützt unbekannte Inhalte vor dem Überschreiben, reicht `blobId` durch
 *   3 = ab 2.2.0: Fotos und Dateien liegen als Anhänge (`blobId`) auf dem Server und werden angezeigt
 */
export const SCHEMA_VERSION = 3;

/** Kleinste Server-Schnittstelle (`api` in `/api/status` und in der Abgleich-Antwort), mit der diese App-Version arbeitet. 3 = Anhänge. */
export const MIN_SERVER_API = 3;
