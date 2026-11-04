/**
 * Nur für Tests: ein Server im Speicher (echter Server-Code mit einer SQLite-Datenbank im Speicher) und Geräte (je eine eigene
 * IndexedDB), die sich mit ihm abgleichen. Nichts davon gehört in die App; der Web-Build importiert diese Datei nie.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { JSONContent } from '@tiptap/core';
import * as Y from 'yjs';
import { markEpochRestored, openDb } from '../../../../../server/src/db';
import { exchange, type ExchangeRequest as ServerExchangeRequest } from '../../../../../server/src/collab/exchange';
import { createPeers, type Peers } from '../../../../../server/src/collab/peers';
import { putProtocol, type PutOptions } from '../../../../../server/src/collab/testing';
import { applySync, type SyncRequest as ServerSyncRequest, type SyncUser } from '../../../../../server/src/sync';
import { BlobError, checkUpload, findBlob, readBlobData, storeBlob } from '../../../../../server/src/blobs';
import { bytesToBase64 } from '@/core/domain/base64';
import type { BlobTransport } from '../blobSync';
import { HubDb } from '@/core/db/db';
import { ProtoError } from '../http';
import { MIN_SERVER_API } from '../schemaVersion';
import { performSync, type SyncResponse } from '../sync';
import { EPOCH_KEY, type ExchangeResponse, type ExchangeTransport } from './wire';
import { FIELD, yDocToJson } from './yJson';

export const ANNA: SyncUser = { id: 'user-anna', role: 'betreuer' };
export const BEN: SyncUser = { id: 'user-ben', role: 'betreuer' };

/** Wie auf dem Draht: nur JSON, keine geteilten Objekte. */
export const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class TestServer {
  db: DatabaseSync = openDb(':memory:');
  readonly peers: Peers = createPeers();
  /** Anfragen an den Austausch, in der Reihenfolge (für Prüfungen wie „es wurde nichts gesendet“). */
  readonly exchanges: ServerExchangeRequest[] = [];
  /** Solange gesetzt, ist der Server nicht erreichbar. */
  offline = false;

  /** Ein Gerät dieses Nutzers hört diesen Server an. */
  transport(user: SyncUser, epoch?: () => Promise<string | undefined> | string | undefined): ExchangeTransport {
    return async (req) => {
      if (this.offline) throw new ProtoError('Keine Verbindung zum Server.', 0);
      const body = wire({ ...req, epoch: (await epoch?.()) ?? req.epoch }) as ServerExchangeRequest;
      this.exchanges.push(body);
      const res = exchange(this.db, body, user, this.peers);
      return { ...wire(res), api: MIN_SERVER_API } as ExchangeResponse;
    };
  }

  /** Anhänge über dieselben Regeln wie der echte Server (Prüfung beim Hochladen, Zugriff beim Abruf). */
  blobsOf(user: SyncUser): BlobTransport {
    return {
      upload: async (meta, data) => {
        try {
          const upload = checkUpload({ id: meta.id, kind: meta.kind, name: meta.name, mime: meta.mime, data: bytesToBase64(data) });
          storeBlob(this.db, { id: meta.id, ...upload, uploaderId: user.id });
        } catch (e) {
          if (e instanceof BlobError) throw new ProtoError(e.message, e.status);
          throw e;
        }
      },
      download: async (id) => {
        if (!findBlob(this.db, id, user.id)) throw new ProtoError('Nicht gefunden', 404);
        return new Uint8Array(readBlobData(this.db, id)!);
      },
    };
  }

  /** Abgleich der Kopfdaten (`/api/sync`) und danach des Textes für ein Gerät. */
  syncOf(store: HubDb, user: SyncUser, opts: { full?: boolean } = {}, blobs: BlobTransport = this.blobsOf(user)) {
    return performSync(
      async (req) => {
        if (this.offline) throw new ProtoError('Keine Verbindung zum Server.', 0);
        const res = applySync(this.db, wire(req) as unknown as ServerSyncRequest, user);
        return { ...wire(res), api: MIN_SERVER_API } as unknown as SyncResponse;
      },
      opts,
      store,
      blobs,
      this.transport(user, async () => (await store.kv.get(EPOCH_KEY))?.value as string | undefined),
    );
  }

  /** Legt ein Protokoll mit Yjs-Text beim Server an (wie nach der Umstellung). */
  put(opts: PutOptions): string {
    return putProtocol(this.db, opts);
  }

  /**
   * Ersetzt die Datenbank. Ohne Angabe ist sie neu und leer (zum Beispiel ein Volume nicht eingebunden): Die Geräte haben die einzigen
   * Kopien. Mit `restored` ist es eine gewollte Wiederherstellung, auf den Geräten gilt der Stand des Servers.
   */
  replaceDatabase(opts: { restored?: boolean } = {}): void {
    this.db = openDb(':memory:');
    if (opts.restored) markEpochRestored(this.db);
  }

  row(id: string) {
    return this.db.prepare('SELECT * FROM protocols WHERE id = ?').get(id) as { content: string; rev: number; title: string; ymode: number; shared: number } | undefined;
  }
}

let n = 0;
const devices: HubDb[] = [];
/** Ein neues Gerät mit leerer lokaler Datenbank. Mit `closeDevices()` nach dem Test wieder entfernen. */
export const newDevice = (label = 'geraet'): HubDb => {
  const device = new HubDb(`test-${label}-${++n}-${Math.random().toString(36).slice(2, 8)}`);
  devices.push(device);
  return device;
};

export async function closeDevices(): Promise<void> {
  for (const d of devices.splice(0)) await d.delete();
}

/** Der Text eines Y-Dokuments, Absätze durch Zeilenumbruch getrennt. */
export function textOf(doc: Y.Doc): string {
  const lines: string[] = [];
  const walk = (n: JSONContent, out: string[]) => {
    if (n.text) out.push(n.text);
    n.content?.forEach((c) => walk(c, out));
  };
  for (const block of yDocToJson(doc).content ?? []) {
    const out: string[] = [];
    walk(block, out);
    lines.push(out.join(''));
  }
  return lines.join('\n');
}

/** Schreibt wie ein Nutzer in den ersten Absatz (an das Ende, oder an `at`); legt ihn an, wenn es noch keinen gibt. */
export function typeInto(doc: Y.Doc, text: string, at?: number): void {
  const frag = doc.getXmlFragment(FIELD);
  doc.transact(() => {
    let para = frag.get(0) as Y.XmlElement | undefined;
    if (!para) {
      para = new Y.XmlElement('paragraph');
      frag.insert(0, [para]);
    }
    let node = para.get(0) as Y.XmlText | undefined;
    if (!node) {
      node = new Y.XmlText();
      para.insert(0, [node]);
    }
    node.insert(at ?? node.length, text);
  });
}
