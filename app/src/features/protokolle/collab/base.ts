import type { JSONContent } from '@tiptap/core';
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { appSchema } from '../editorSchema';
import { FIELD, vocabularyProblem } from './yJson';

/**
 * Protokolle aus der Zeit vor 3.0.0 haben ihren Text nur als JSON. Wer sie zuerst öffnet und nie gesendet hat (der Server hat noch
 * keinen Text dazu), baut aus dem Schnappschuss die Basis des Yjs-Dokuments. Das macht der Editor selbst (y-tiptap), damit die Struktur
 * genau die ist, die er beim Öffnen erwartet: Dann schreibt das Öffnen nichts mehr ins Dokument.
 *
 * Eine Basis entsteht nur auf einem Gerät, das den Text allein hat. Zwei Basen desselben Inhalts zusammenzuführen würde ihn verdoppeln;
 * für Protokolle, die der Server kennt, holt das Gerät deshalb den Zustand und baut nie selbst eine Basis.
 */

/** Hat der Schnappschuss keinen Inhalt? Ein leeres Dokument und eines mit nur leeren Absätzen sind gleich: Der Editor legt den ersten Absatz beim Tippen an. */
export function isEmptySnapshot(json: JSONContent | undefined): boolean {
  if (!json?.content?.length) return true;
  return json.content.every((n) => n.type === 'paragraph' && !n.content?.length);
}

/** Warum sich aus diesem Schnappschuss keine Basis bauen lässt (der Editor würde sie nicht öffnen), oder `null`. */
export function baseProblem(json: JSONContent): string | null {
  return vocabularyProblem(json);
}

/** Die Basis als Zustand. Wirft, wenn der Schnappschuss nicht zum Schema passt (vorher `baseProblem` prüfen). */
export function buildBase(json: JSONContent): Uint8Array {
  const doc = prosemirrorJSONToYDoc(appSchema(), json, FIELD);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}
