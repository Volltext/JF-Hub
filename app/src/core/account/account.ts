import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/core/db/db';

export type Role = 'admin' | 'betreuer';

/** Das angemeldete Konto (vom Server bestätigt, lokal für die Offline-Anzeige gemerkt). */
export interface Account {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export interface DirectoryUser {
  id: string;
  name: string;
}

const ACCOUNT_KEY = 'account';
const DIRECTORY_KEY = 'directory';

export async function loadAccount(): Promise<Account | null> {
  return ((await db.kv.get(ACCOUNT_KEY))?.value as Account | undefined) ?? null;
}

export async function saveAccount(account: Account): Promise<void> {
  await db.kv.put({ key: ACCOUNT_KEY, value: account });
}

export async function saveDirectory(users: DirectoryUser[]): Promise<void> {
  await db.kv.put({ key: DIRECTORY_KEY, value: users });
}

/** `undefined` = lädt noch, `null` = nicht angemeldet. */
export function useAccount(): Account | null | undefined {
  return useLiveQuery(async () => ((await db.kv.get(ACCOUNT_KEY))?.value as Account | undefined) ?? null, []);
}

/** Alle Benutzer des Servers (für „von Anna“-Anzeigen). */
export function useDirectory(): DirectoryUser[] {
  return useLiveQuery(async () => ((await db.kv.get(DIRECTORY_KEY))?.value as DirectoryUser[] | undefined) ?? [], []) ?? [];
}

/**
 * Gehört der Eintrag dem angemeldeten Konto? Einträge ohne Besitzer wurden lokal angelegt und noch nicht abgeglichen
 * (oder die App läuft ohne Server) – sie gehören dem Gerät.
 */
export function isMine(entry: { ownerId?: string }, account: Account | null | undefined): boolean {
  return !entry.ownerId || !account || entry.ownerId === account.id;
}

/** Kurzer Hinweis, wem ein Eintrag gehört und wer ihn sieht („privat“, „veröffentlicht“, „von Anna“). */
export function visibilityLabel(entry: { ownerId?: string; shared?: boolean }, account: Account | null | undefined, users: DirectoryUser[]): string {
  if (isMine(entry, account)) return entry.shared ? 'veröffentlicht' : 'privat';
  const name = users.find((u) => u.id === entry.ownerId)?.name;
  return name ? `von ${name}` : 'von einem anderen Betreuer';
}
