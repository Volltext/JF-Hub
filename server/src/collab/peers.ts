/**
 * Wer hat ein Protokoll gerade geöffnet? Der offene Editor meldet sich bei jedem Austausch (`live`); der Server merkt sich das
 * kurz im Speicher und nennt es den anderen, die dasselbe Protokoll sehen dürfen. Nichts davon wird gespeichert.
 */
export interface Peers {
  /** Der Nutzer hat das Protokoll jetzt geöffnet. */
  touch(docId: string, userId: string, now: number): void;
  /** Nutzer-IDs, die das Protokoll innerhalb der Frist geöffnet hatten, ohne `exceptUserId`. */
  list(docId: string, exceptUserId: string, now: number): string[];
}

/** So lange gilt eine Meldung (der Editor fragt alle ~2,5 s). */
export const PEER_TTL_MS = 15_000;

export function createPeers(ttlMs = PEER_TTL_MS): Peers {
  const docs = new Map<string, Map<string, number>>();
  let lastSweep = 0;

  const prune = (docId: string, now: number): Map<string, number> | undefined => {
    const users = docs.get(docId);
    if (!users) return undefined;
    for (const [user, at] of users) if (now - at > ttlMs) users.delete(user);
    if (!users.size) {
      docs.delete(docId);
      return undefined;
    }
    return users;
  };

  return {
    touch(docId, userId, now) {
      // Dokumente, die niemand mehr abfragt, räumt gelegentlich ein Durchgang über alle ab.
      if (now - lastSweep > 60_000) {
        lastSweep = now;
        for (const id of [...docs.keys()]) prune(id, now);
      }
      const users = prune(docId, now) ?? new Map<string, number>();
      users.set(userId, now);
      docs.set(docId, users);
    },
    list(docId, exceptUserId, now) {
      const users = prune(docId, now);
      return users ? [...users.keys()].filter((u) => u !== exceptUserId).sort() : [];
    },
  };
}
