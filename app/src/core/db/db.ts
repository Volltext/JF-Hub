import Dexie, { type Table } from 'dexie';
import type { KeyValue, Member, Session, Task } from '@/core/domain/types';
import type { LineupTemplate, Run } from '@/features/wettkampf/model';
import type { Ordner, Protokoll } from '@/features/protokolle/model';
import { preserveUnsent } from '@/features/protokolle/legacyUnsent';
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

/**
 * Der Text eines Protokolls als Yjs-Dokument (seit 3.0.0). `update` ist der vollständige Zustand; er wächst nur durch Mischen
 * (`Y.mergeUpdates`), nie durch Überschreiben, damit zwei Tabs und der Hintergrund-Abgleich einander nichts nehmen.
 */
export interface YDocRow {
  id: string;
  /** Vollständiger Zustand (`Y.encodeStateAsUpdate`). */
  update: Uint8Array;
  /** Zustandsvektor des Servers laut letzter Antwort: Was darüber hinausgeht, fehlt dort. Fehlt er, hat der Server von diesem Text noch nichts bestätigt. */
  serverSv?: Uint8Array;
  /** 1 = es gibt lokale Änderungen, die der Server noch nicht bestätigt hat (Zahl, damit indizierbar). */
  dirty: 0 | 1;
  /** Zählt jedes lokale Schreiben: Ein Austausch erkennt daran, ob während der Übertragung weitergeschrieben wurde. */
  seq: number;
  /** Die Basis wurde auf diesem Gerät aus altem Inhalt gebaut und noch nie bestätigt: Der Server nimmt sie nur an, wenn er noch keinen Text hat. */
  created?: boolean;
  /** Grund, wenn der Server den Text abgelehnt hat (zu groß, ungültig). Er wird erst nach einer weiteren Änderung erneut gesendet. */
  rejected?: string;
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
  ydocs!: Table<YDocRow, string>;

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
    this.version(10)
      .stores({
        /** Der Text der Protokolle als Yjs-Dokument (gemeinsames Bearbeiten). */
        ydocs: 'id, dirty',
      })
      .upgrade(async (tx) => {
        // Änderungen, die vor dem Update noch nicht auf dem Server waren, können den neuen Server nicht mehr im alten Format erreichen
        // (siehe `preserveUnsent`): Sie bleiben als eigene Kopie erhalten; das Original gleicht sich mit dem Server ab.
        const protokolle = tx.table('protokolle');
        const { copies, cleaned } = preserveUnsent((await protokolle.toArray()) as Protokoll[]);
        for (const c of copies) await protokolle.add(c);
        for (const id of cleaned) await protokolle.update(id, { dirty: 0 });
        // Alles neu vom Server holen: Die Zeilen bekommen ihren Schnappschuss und ihre Feldzeiten, und was lokal nur als ungesendete Fassung stand, wird ersetzt.
        await tx.table('kv').delete('protokolle.rev');
      });
  }
}

export const db = new HubDb();

export const TABLES = ['members', 'sessions', 'tasks'] as const;
