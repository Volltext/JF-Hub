import Dexie, { type Table } from 'dexie';
import type { KeyValue, Member, Session, Task } from '@/core/domain/types';
import type { LineupTemplate, Run } from '@/features/wettkampf/model';
import type { Ordner, Protokoll } from '@/features/protokolle/model';
import type { ClothingItem, ClothingRecord } from '@/features/kleidung/model';

/**
 * Zentrale lokale Datenbank. Neue Features erweitern das Schema über eine neue
 * `version(n)` – bestehende Versionen werden nie verändert.
 */
export type SyncCollection = 'members' | 'sessions' | 'tasks' | 'clothing' | 'clothingItems' | 'runs' | 'lineupTemplates';

export interface OutboxEntry {
  /** `${collection}:${id}` */
  key: string;
  collection: SyncCollection;
  id: string;
  updatedAt: number;
  /** 1 = Datensatz wurde gelöscht. */
  deleted: 0 | 1;
}

/**
 * Ein Anhang (Foto oder Datei) eines Protokolls, lokal abgelegt. Im Protokoll steht nur `blobId`; die Bytes liegen getrennt in
 * `blobData`, damit Listen und Aufräumen nicht jedes Mal alle Bilder laden.
 */
export interface LocalBlob {
  id: string;
  kind: 'photo' | 'file';
  mime: string;
  name: string;
  size: number;
  /** `local`: nur auf diesem Gerät, wartet auf den Upload. `synced`: der Server hat ihn; diese Kopie darf verdrängt werden. */
  state: 'local' | 'synced';
  /** Grund, wenn der Server den Upload abgelehnt hat (zu groß, kein JPEG …). Bis „Alles neu abgleichen“ gibt es keinen neuen Versuch. */
  rejected?: string;
  /** Wie oft der Upload an einem Serverfehler oder Zeitlimit gescheitert ist; danach wartet er mit wachsender Pause (`retryAt`). */
  failures?: number;
  retryAt?: number;
  createdAt: number;
  /** Letzte Nutzung, für das Verdrängen der ältesten Kopien. */
  lastUsedAt: number;
}

export interface BlobData {
  id: string;
  data: Uint8Array;
}

export class HubDb extends Dexie {
  members!: Table<Member, string>;
  sessions!: Table<Session, string>;
  tasks!: Table<Task, string>;
  kv!: Table<KeyValue, string>;
  runs!: Table<Run, string>;
  lineupTemplates!: Table<LineupTemplate, string>;
  protokolle!: Table<Protokoll, string>;
  folders!: Table<Ordner, string>;
  outbox!: Table<OutboxEntry, string>;
  clothing!: Table<ClothingRecord, string>;
  clothingItems!: Table<ClothingItem, string>;
  blobs!: Table<LocalBlob, string>;
  blobData!: Table<BlobData, string>;

  constructor(name = 'jf-hub') {
    super(name);
    this.version(1).stores({
      members: 'id, name, kind, active',
      sessions: 'id, date',
      tasks: 'id, dueDate, completed, sessionId',
      kv: 'key',
    });
    this.version(2).stores({
      dienstbuch: 'id, datum, status, updatedAt',
    });
    this.version(3).stores({
      runs: 'id, mode, createdAt',
      lineupTemplates: 'id',
    });
    this.version(4).stores({
      protokolle: 'id, datum, updatedAt, dirty',
    });
    this.version(5).stores({
      folders: 'id, parentId, dirty',
    });
    this.version(6).stores({
      /** Noch nicht an den Server gemeldete Änderungen an Mitgliedern, Diensten und Aufgaben. */
      outbox: 'key',
    });
    this.version(7).stores({
      /** Kleidergrößen je Mitglied (ID = Mitglieds-ID) und die Arten von Kleidungsstücken. */
      clothing: 'id',
      clothingItems: 'id, order',
    });
    this.version(8).stores({
      /** Das Dienstbuch (Feuer-On-Anbindung) gibt es nicht mehr. */
      dienstbuch: null,
    });
    this.version(9).stores({
      /** Fotos und Dateien der Protokolle: Angaben (zum Auswählen und Verdrängen) und Bytes getrennt. */
      blobs: 'id, state, lastUsedAt',
      blobData: 'id',
    });
  }
}

export const db = new HubDb();

export const TABLES = ['members', 'sessions', 'tasks'] as const;
