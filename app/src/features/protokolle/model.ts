import type { JSONContent } from '@tiptap/core';
import { newId, todayIso } from '@/core/domain/id';
import { nowTime } from '@/core/domain/time';

/**
 * Kopffelder eines Protokolls. Jedes trägt seine eigene Änderungszeit (`Protokoll.metaAt`), der Abgleich führt sie einzeln zusammen:
 * Bei gleichzeitigen Änderungen gewinnt Feld für Feld die jüngere. Der Text liegt als Yjs-Dokument in `ydocs` (siehe `collab/`).
 */
export const META_FIELDS = ['title', 'datum', 'beginn', 'ende', 'ort', 'leitung', 'folderId', 'shared'] as const;
export type MetaField = (typeof META_FIELDS)[number];
/** Zeitpunkt (ms) der letzten Änderung je Kopffeld. */
export type MetaAt = Partial<Record<MetaField, number>>;

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
  /**
   * Schnappschuss des Textes für Liste, Suche und die Nur-lesen-Ansicht. Der Text selbst liegt als Yjs-Dokument in `ydocs`; er wird aus
   * diesem Dokument (oder vom Server) abgeleitet und nie direkt bearbeitet.
   */
  content: JSONContent;
  /** true = für alle Betreuer sichtbar, sonst nur für den Besitzer. */
  shared?: boolean;
  /** Besitzer (Benutzer-ID); fehlt bei lokal angelegten, noch nie abgeglichenen Protokollen. */
  ownerId?: string;
  /** Letzte bekannte Server-Revision (0 = noch nie gesendet). */
  rev: number;
  /** Lokale Änderungszeit (ms). */
  updatedAt: number;
  /** 1 = lokale Änderungen an den Kopfdaten noch nicht auf dem Server (Zahl, damit indizierbar). Der Text hat sein eigenes Merkmal in `ydocs`. */
  dirty: 0 | 1;
  /** Wann welches Kopffeld zuletzt hier geändert wurde; fehlt bei Zeilen aus der Zeit vor 3.0.0. */
  metaAt?: MetaAt;
  /** true = der Server hat den Text noch nicht auf gemeinsames Bearbeiten umgestellt: nur lesen. */
  legacy?: boolean;
  /**
   * Revision des Protokolls bei der letzten Antwort des Servers zum Text. Liegt `rev` darüber, hat sich seitdem etwas geändert und der
   * Text wird im Hintergrund abgeglichen; stimmt sie beim Austausch noch, entfällt dort die Rechnung. Fehlt sie, kennt dieses Gerät den Text noch nicht.
   */
  textRev?: number;
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

/** Zeiten für geänderte Kopffelder: jeweils jetzt, aber nie gleich oder früher als die bisherige Zeit des Feldes (sonst ginge eine zweite Änderung in derselben Millisekunde unter). */
export function stampMeta(old: MetaAt | undefined, fields: readonly MetaField[], now = Date.now()): MetaAt {
  const next: MetaAt = { ...old };
  for (const f of fields) next[f] = Math.max(now, (old?.[f] ?? 0) + 1);
  return next;
}

export function newProtokoll(folderId = '', shared = false): Protokoll {
  const now = Date.now();
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
    updatedAt: now,
    dirty: 1,
    metaAt: stampMeta(undefined, META_FIELDS, now),
    deleted: 0,
  };
}

/** Kopffelder, die der Editor ändern kann. Der Text kommt nicht hier hinein, er wird zusammen bearbeitet (`collab/`). */
export type ProtokollPatch = Partial<Pick<Protokoll, MetaField>>;
