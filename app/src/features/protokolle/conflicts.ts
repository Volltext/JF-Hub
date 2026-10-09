import { useLiveQuery } from 'dexie-react-hooks';
import { db, type HubDb } from '@/core/db/db';

/**
 * Ein Konflikt, den die Nutzerin oder der Nutzer noch nicht gesehen hat: Jemand hat ein Protokoll gleichzeitig geändert,
 * `id` ist das Original (jetzt mit der anderen Fassung), `copyId` die Kopie mit der eigenen Fassung.
 * Ein Hinweis, der nur im Tooltip des Sync-Symbols stand, war auf dem Handy unsichtbar; dieser hier bleibt stehen, bis er bestätigt wird.
 */
export interface ConflictNote {
  id: string;
  copyId: string;
  /** Zeitpunkt der letzten Meldung (ms). */
  at: number;
}

export const CONFLICTS_KEY = 'protokolle.conflicts';
const MAX_NOTES = 20;

export async function loadConflicts(store: HubDb = db): Promise<ConflictNote[]> {
  return ((await store.kv.get(CONFLICTS_KEY))?.value as ConflictNote[] | undefined) ?? [];
}

/** Merkt Konflikte vor. Dieselbe Kopie (der Server schreibt sie bei gleicher Basis fort) steht nur einmal da. */
export async function noteConflicts(found: { id: string; copyId: string }[], store: HubDb = db, at = Date.now()): Promise<void> {
  if (!found.length) return;
  const old = await loadConflicts(store);
  const kept = old.filter((n) => !found.some((f) => f.copyId === n.copyId));
  const next = [...found.map((f) => ({ id: f.id, copyId: f.copyId, at })), ...kept].slice(0, MAX_NOTES);
  await store.kv.put({ key: CONFLICTS_KEY, value: next });
}

/** Der Hinweis wurde gesehen. */
export async function dismissConflict(copyId: string, store: HubDb = db): Promise<void> {
  const old = await loadConflicts(store);
  if (old.some((n) => n.copyId === copyId)) await store.kv.put({ key: CONFLICTS_KEY, value: old.filter((n) => n.copyId !== copyId) });
}

/** Offene Konflikt-Hinweise; `undefined`, solange sie laden. */
export function useConflicts(): ConflictNote[] | undefined {
  return useLiveQuery(() => loadConflicts(), []);
}
