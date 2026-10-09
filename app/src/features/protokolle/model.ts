import type { JSONContent } from '@tiptap/core';
import { newId, todayIso } from '@/core/domain/id';
import { nowTime } from '@/core/domain/time';

/** Lokale Kopie eines Protokolls; der Server ist die zentrale Ablage, Dexie dient als Offline-Cache. */
export interface Protokoll {
  id: string;
  title: string;
  /** Ordner, in dem das Protokoll liegt; leer/fehlend = oberste Ebene. */
  folderId?: string;
  /** YYYY-MM-DD */
  datum: string;
  /** HH:MM oder leer */
  beginn: string;
  ende: string;
  ort: string;
  leitung: string;
  content: JSONContent;
  /** true = für alle Betreuer sichtbar, sonst nur für den Besitzer. */
  shared?: boolean;
  /** Besitzer (Benutzer-ID); fehlt bei lokal angelegten, noch nie abgeglichenen Protokollen. */
  ownerId?: string;
  /** Letzte bekannte Server-Revision (0 = noch nie gesendet). */
  rev: number;
  /** Lokale Änderungszeit (ms). */
  updatedAt: number;
  /** 1 = lokale Änderungen noch nicht auf dem Server (Zahl, damit indizierbar). */
  dirty: 0 | 1;
  /** 1 = zum Löschen vorgemerkt, wird beim nächsten Sync gemeldet. */
  deleted: 0 | 1;
  /** Grund, wenn der Server genau diese Fassung abgelehnt hat (zu groß, ungültig). Sie wird erst nach einer Änderung erneut gesendet. */
  rejected?: string;
}

/** Ordner zum Strukturieren der Protokolle (beliebig verschachtelbar). */
export interface Ordner {
  id: string;
  name: string;
  /** Übergeordneter Ordner; leer = oberste Ebene. */
  parentId: string;
  rev: number;
  updatedAt: number;
  dirty: 0 | 1;
  deleted: 0 | 1;
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

export function newProtokoll(folderId = '', shared = false): Protokoll {
  return {
    id: newId(),
    title: '',
    folderId,
    datum: todayIso(),
    // Beginn = Zeitpunkt, an dem das Protokoll angelegt wird; das Ende trägt man am Schluss ein.
    beginn: nowTime(),
    ende: '',
    ort: '',
    leitung: '',
    content: EMPTY_DOC,
    shared,
    rev: 0,
    updatedAt: Date.now(),
    dirty: 1,
    deleted: 0,
  };
}

/** Felder, die im Editor änderbar sind. */
export type ProtokollPatch = Partial<Pick<Protokoll, 'title' | 'datum' | 'beginn' | 'ende' | 'ort' | 'leitung' | 'content' | 'folderId' | 'shared'>>;
