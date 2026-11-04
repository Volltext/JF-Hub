import * as Y from 'yjs';
import { db, type HubDb } from '@/core/db/db';
import { sameSnapshot } from './base';
import { yDocToJson } from './yJson';

/**
 * Der Schnappschuss eines Protokolls (`content`: Liste, Suche, Nur-lesen-Ansicht) folgt dem Text, den das Gerät frisch vom Server geholt hat.
 * Sonst zeigte die Liste weiter den Text, den eine Kopie „(lokale Fassung)“ jetzt trägt, oder einen älteren als den geholten. Es ändert sich
 * nur `content`: Weder Änderungszeit noch Vormerkung noch Revision, das Protokoll gilt dadurch nicht als bearbeitet. Liefert, ob etwas
 * geschrieben wurde.
 */
export async function refreshSnapshot(id: string, state: Uint8Array, store: HubDb = db): Promise<boolean> {
  const doc = new Y.Doc();
  let json;
  try {
    Y.applyUpdate(doc, state);
    json = yDocToJson(doc);
  } catch {
    return false; // ein Text, den kein Editor baut, bleibt beim bisherigen Schnappschuss
  } finally {
    doc.destroy();
  }
  const row = await store.protokolle.get(id);
  if (!row || sameSnapshot(row.content, json)) return false;
  await store.protokolle.update(id, { content: json });
  return true;
}
