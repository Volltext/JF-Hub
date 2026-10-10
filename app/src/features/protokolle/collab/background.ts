import { db, type HubDb } from '@/core/db/db';
import { baseProblem, buildBase, isEmptySnapshot } from './base';
import { saveLocalCopy } from './localCopy';
import { isSessionOpen } from './session';
import { answerOf, requestFor, type ExchangeDocRequest, type ExchangeTransport } from './wire';
import { applyAnswer, discard, forgetServerState, markRejected, putBase } from './yStore';

/**
 * Austausch des Textes für Protokolle, die gerade nicht in einem Editor offen sind: eigene Änderungen senden (zum Beispiel nach dem
 * Schreiben ohne Netz), Änderungen anderer holen und die Texte neuer Protokolle vorladen, damit sie auch ohne Netz bearbeitbar sind.
 * Offene Editoren tauschen selbst aus (`session.ts`); ihre Texte lässt dieser Lauf in Ruhe.
 */

export interface BackgroundOptions {
  store?: HubDb;
  transport: ExchangeTransport;
  /** Welche Texte hat ein Editor gerade offen? */
  isOpen?: (id: string) => boolean;
  /** Protokolle je Lauf. Weitere kommen im nächsten Lauf dran. */
  maxDocs?: number;
  /** Auch Texte noch einmal senden, die der Server abgelehnt hat („Alles neu abgleichen“). Sonst bleiben sie liegen, bis sie geändert werden. */
  retryRejected?: boolean;
  /**
   * Größe einer Anfrage in Base64-Zeichen, ab der weitere Texte auf den nächsten Lauf warten (der erste kommt immer). Ohne Grenze könnten
   * 20 ungesendete Texte zusammen das Anfragelimit des Servers oder eines Proxys sprengen, und der Lauf scheiterte jedes Mal gleich.
   */
  maxRequestChars?: number;
}

/** Deutlich unter dem Anfragelimit des Servers (24 MiB); ein einzelner Text darf größer sein (er geht allein). */
const MAX_REQUEST_CHARS = 6_000_000;

export interface BackgroundResult {
  /** Wie viele Protokolle in diesem Lauf mit dem Server abgeglichen wurden. */
  exchanged: number;
  /** Davon: eigene Änderungen gesendet. */
  sent: number;
  /** Protokolle, deren Text noch aussteht (nächster Lauf). */
  remaining: number;
  /** Texte, die der Server nicht mehr herausgibt und die als Kopie gesichert wurden. */
  copies: number;
  /** Die Datenbank des Servers wurde ersetzt: Der Abgleich der Protokolle muss aufräumen. */
  reset: boolean;
  /** Anhänge, die der Server vermisst. */
  missingBlobs: string[];
  /** Der Server nimmt Texte nicht an (zu groß, ungültig). */
  rejected: number;
}

const EMPTY: BackgroundResult = { exchanged: 0, sent: 0, remaining: 0, copies: 0, reset: false, missingBlobs: [], rejected: 0 };

const recency = (a: { datum: string; updatedAt: number }, b: { datum: string; updatedAt: number }) => (b.datum || '').localeCompare(a.datum || '') || b.updatedAt - a.updatedAt;

/**
 * Protokolle, die nie gesendet wurden und Inhalt aus der Zeit vor 3.0.0 haben, bekommen ihre Basis (siehe `base.ts`). Das muss vor dem
 * ersten Abgleich der Kopfdaten geschehen: Danach hat das Protokoll eine Revision, und das Gerät könnte nicht mehr unterscheiden, ob der
 * Server den Text kennt. Liefert die Zahl der angelegten Basen.
 */
export async function ensureBases(store: HubDb = db): Promise<number> {
  const known = new Set((await store.ydocs.toCollection().primaryKeys()) as string[]);
  let made = 0;
  for (const p of await store.protokolle.filter((x) => x.rev === 0 && x.deleted === 0 && !x.legacy).toArray()) {
    if (known.has(p.id) || isEmptySnapshot(p.content) || baseProblem(p.content)) continue;
    await putBase(p.id, buildBase(p.content), store);
    made++;
  }
  return made;
}

export async function exchangeInBackground(opts: BackgroundOptions): Promise<BackgroundResult> {
  const store = opts.store ?? db;
  const isOpen = opts.isOpen ?? isSessionOpen;
  const maxDocs = opts.maxDocs ?? 20;
  const maxChars = opts.maxRequestChars ?? MAX_REQUEST_CHARS;
  const result: BackgroundResult = { ...EMPTY, missingBlobs: [] };

  // Der Text eines Protokolls, das der Server noch nicht kennt (`rev` 0: die Kopfdaten sind noch nicht angekommen), wartet auf den Abgleich der Kopfdaten.
  const protocols = (await store.protokolle.filter((p) => p.deleted === 0 && !p.legacy && p.rev > 0).toArray()).filter((p) => !isOpen(p.id)).sort(recency);
  const known = new Set((await store.ydocs.toCollection().primaryKeys()) as string[]);
  const dirty = new Set((await store.ydocs.where('dirty').equals(1).primaryKeys()) as string[]);

  // Reihenfolge: zuerst eigene Änderungen, dann was sich beim Server geändert hat, zuletzt neue Texte (neueste zuerst).
  const wanted = [
    ...protocols.filter((p) => known.has(p.id) && dirty.has(p.id)),
    ...protocols.filter((p) => known.has(p.id) && !dirty.has(p.id) && (p.textRev ?? -1) < p.rev),
    ...protocols.filter((p) => !known.has(p.id)),
  ];
  const batch = wanted.slice(0, maxDocs);
  result.remaining = Math.max(0, wanted.length - batch.length);
  if (!batch.length) return result;

  const docs: ExchangeDocRequest[] = [];
  const sentSeq = new Map<string, number>();
  const sending = new Set<string>();
  let chars = 0;
  for (const p of batch) {
    const row = await store.ydocs.get(p.id);
    if (!row) {
      docs.push({ id: p.id });
      sentSeq.set(p.id, 0);
      continue;
    }
    if (row.rejected && row.dirty === 1 && !opts.retryRejected) continue; // nicht erneut senden, bis wieder etwas geändert wurde
    const req = requestFor(row, p.textRev);
    const size = (req.update?.length ?? 0) + (req.sv?.length ?? 0);
    if (docs.length && chars + size > maxChars) {
      result.remaining++; // passt nicht mehr in diese Anfrage: im nächsten Lauf
      continue;
    }
    chars += size;
    sentSeq.set(p.id, row.seq);
    if (req.update) sending.add(p.id);
    docs.push(req);
  }
  if (!docs.length) return result;

  const res = await opts.transport({ docs });
  if (res.reset) return { ...result, reset: true };

  for (const r of res.docs) {
    const seq = sentSeq.get(r.id);
    if (seq === undefined) continue; // eine Antwort auf etwas, das nicht gefragt war
    switch (r.status) {
      case 'ok':
        // Nur was die Anfrage enthielt, gilt als gesendet; ein Text, der nicht dabei war (abgelehnt, nichts zu senden), bleibt, wie er ist.
        await applyAnswer(r.id, answerOf(r), sending.has(r.id) ? seq : undefined, store);
        result.exchanged++;
        if (sending.has(r.id)) result.sent++;
        result.missingBlobs.push(...(r.missingBlobs ?? []));
        break;
      case 'gone': {
        // Ungesendete Änderungen bleiben als eigenes Protokoll erhalten; das Protokoll selbst räumt der nächste Abgleich der Kopfdaten ab.
        const row = await store.ydocs.get(r.id);
        if (row?.dirty === 1 && (await saveLocalCopy(r.id, {}, store))) result.copies++;
        await discard(r.id, store);
        break;
      }
      case 'legacy':
        await store.protokolle.update(r.id, { legacy: true });
        break;
      case 'exists':
        // Der Server hatte schon Text mit anderer Geschichte: die eigene Fassung als Kopie sichern, danach den Zustand des Servers holen.
        if (await saveLocalCopy(r.id, {}, store)) result.copies++;
        await discard(r.id, store);
        await store.protokolle.update(r.id, { textRev: undefined });
        result.remaining++;
        break;
      case 'rejected':
        await markRejected(r.id, r.reason ?? 'abgelehnt', seq, store);
        result.rejected++;
        break;
      case 'resync':
        await forgetServerState(r.id, store);
        result.remaining++;
        break;
      case 'deferred':
        result.remaining++;
        break;
    }
  }
  return result;
}
