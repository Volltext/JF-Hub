import * as Y from 'yjs';
import type { YDocRow } from '@/core/db/db';
import { base64ToBytes, bytesToBase64 } from '@/core/domain/base64';
import { ProtoError, loadConn, request } from '../http';
import { isEmptyUpdate } from './yStore';

/** Wire-Format von `POST /api/collab/exchange`, identisch mit `server/src/collab/exchange.ts` (Binärdaten als Base64). */
export interface ExchangeDocRequest {
  id: string;
  sv?: string;
  update?: string;
  rev?: number;
  live?: boolean;
  create?: boolean;
}

export type ExchangeStatus = 'ok' | 'gone' | 'legacy' | 'exists' | 'rejected' | 'resync' | 'deferred';

export interface ExchangeDocResult {
  id: string;
  status: ExchangeStatus;
  update?: string;
  sv?: string;
  rev?: number;
  peers?: string[];
  missingBlobs?: string[];
  reason?: string;
}

export interface ExchangeRequest {
  epoch?: string;
  docs: ExchangeDocRequest[];
}

export interface ExchangeResponse {
  epoch?: string;
  /** true: Die Datenbank des Servers wurde ersetzt, nichts wurde angewendet; der nächste Abgleich der Protokolle räumt auf. */
  reset?: boolean;
  docs: ExchangeDocResult[];
  api?: number;
}

/** Schickt eine Anfrage an den Austausch und liefert die Antwort. In Tests durch den Server-Code ersetzt. */
export type ExchangeTransport = (req: ExchangeRequest) => Promise<ExchangeResponse>;

/**
 * Die Anfrage für ein Dokument aus dem lokalen Zustand: was dem Server fehlt, der eigene Zustandsvektor und die Revision der letzten
 * Antwort (`textRev`). Die Revision schickt nur mit, wer nichts zu senden hat: Sie erlaubt dem Server, die Rechnung zu sparen.
 */
export function requestFor(row: YDocRow, textRev: number | undefined): ExchangeDocRequest {
  const diff = row.serverSv ? Y.diffUpdate(row.update, row.serverSv) : row.update;
  const sending = !isEmptyUpdate(diff) && row.dirty === 1;
  return {
    id: row.id,
    sv: bytesToBase64(Y.encodeStateVectorFromUpdate(row.update)),
    ...(sending ? { update: bytesToBase64(diff) } : {}),
    ...(!sending && textRev !== undefined ? { rev: textRev } : {}),
    ...(sending && row.created ? { create: true } : {}),
  };
}

/** Die Antwort eines Dokuments als Bytes. */
export function answerOf(res: ExchangeDocResult): { update?: Uint8Array; sv?: Uint8Array; rev?: number } {
  return {
    ...(res.update ? { update: base64ToBytes(res.update) } : {}),
    ...(res.sv ? { sv: base64ToBytes(res.sv) } : {}),
    ...(res.rev === undefined ? {} : { rev: res.rev }),
  };
}

/** Der Abgleich der Protokolle merkt sich die Kennung der Datenbank des Servers (siehe `sync.ts`). */
export const EPOCH_KEY = 'protokolle.epoch';

/** Es ist kein Server eingerichtet (Browser-Demo, Android ohne Server) oder niemand angemeldet: nichts auszutauschen, aber auch nicht „offline“. */
export class NoServer extends ProtoError {
  constructor() {
    super('Kein Server eingerichtet.', 0);
  }
}

/** Der Austausch über HTTP. Ohne eingerichteten Server oder Anmeldung wirft er `NoServer`. */
export const httpExchange =
  (epoch: () => Promise<string | undefined>): ExchangeTransport =>
  async (req) => {
    const conn = await loadConn();
    if (!conn.url || !conn.token) throw new NoServer();
    try {
      return await request<ExchangeResponse>(conn, 'POST', '/api/collab/exchange', { ...req, epoch: await epoch() }, false, { timeoutMs: 90_000 });
    } catch (e) {
      if (e instanceof ProtoError) {
        // Die Datenbank des Servers wurde ersetzt: nichts wurde angewendet, der nächste Abgleich der Protokolle räumt auf.
        if (e.status === 409 && (e.body as { reset?: unknown } | undefined)?.reset === true) return { reset: true, docs: [] };
        // Ein Server vor 3.0.0 kennt die Schnittstelle nicht.
        if (e.status === 404) throw new ProtoError('Der Server ist zu alt für diese App-Version. Bitte den Server aktualisieren.', 426);
        // Ein Proxy vor dem Server nimmt die Anfrage nicht an, weil sie ihm zu groß ist (nginx: `client_max_body_size`).
        if (e.status === 413) throw new ProtoError('Die Anfrage ist für den Server oder einen Proxy davor zu groß. Bei einem eigenen Proxy die maximale Anfragegröße erhöhen (siehe Installationsanleitung).', 413);
      }
      throw e;
    }
  };
