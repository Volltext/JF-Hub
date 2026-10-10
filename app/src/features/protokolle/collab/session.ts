import * as Y from 'yjs';
import { db, type HubDb } from '@/core/db/db';
import { bytesToBase64 } from '@/core/domain/base64';
import { jsonEqual } from '@/core/domain/equal';
import { ProtoError } from '../http';
import { isEmptySnapshot } from './base';
import { saveLocalCopy } from './localCopy';
import { NoServer, answerOf, type ExchangeDocRequest, type ExchangeTransport } from './wire';
import { repairDoc } from './repair';
import { docProblem, yDocToJson } from './yJson';
import { applyAnswer, compact, discard, forgetServerState, getYRow, isEmptyUpdate, markRejected, putLocal } from './yStore';

/**
 * Eine offene Bearbeitung: hält das Yjs-Dokument des Protokolls, sichert Änderungen auf dem Gerät, tauscht sie alle paar Sekunden mit
 * dem Server aus und schreibt den Schnappschuss für Liste und Suche. Der Editor hängt sich nur an `doc`; alles andere läuft hier und
 * lässt sich ohne Editor testen.
 *
 * Der Austausch ist zustandslos (siehe `server/src/collab/exchange.ts`): Jede Runde schickt, was dem Server laut letzter Antwort fehlt,
 * und holt, was diesem Dokument fehlt. Fällt eine Antwort aus, geht dasselbe noch einmal hin; Yjs wendet es ohne Wirkung ein zweites
 * Mal an.
 */

/** Herkunft von Änderungen, die vom Server kommen (nicht in Rückgängig, nicht erneut als eigene Änderung gesichert). */
export const REMOTE = 'jfh-remote';
/** Herkunft einer Ergänzung beim Empfangen (`applyRemote`): eine Änderung dieses Geräts, die gesichert und gesendet wird. */
const REPAIR = 'jfh-repair';

export type SessionStatus =
  /** Läuft (auch offline). */
  | 'ok'
  /** Das Protokoll ist gelöscht oder nicht mehr für dieses Konto sichtbar. */
  | 'gone'
  /** Der Server hat Inhalte, die diese App-Version nicht kennt: nur lesen, nichts mehr übernehmen. */
  | 'blocked'
  /** Der Server hat den Text noch nicht umgestellt. */
  | 'legacy'
  /** Der Server hatte schon einen anderen Text: die eigene Fassung liegt als Kopie vor, der Editor muss neu öffnen. */
  | 'replaced'
  /** Der Server verlangt eine neuere App oder ist zu alt. */
  | 'outdated'
  /** Nicht angemeldet. */
  | 'auth'
  /** Der Server nimmt den Text nicht an (zu groß, ungültig). Er bleibt auf diesem Gerät. */
  | 'rejected';

export interface SessionInfo {
  status: SessionStatus;
  /** Alle Änderungen sind auf diesem Gerät gesichert. */
  saved: boolean;
  /** Der letzte Austausch hat den Server nicht erreicht. */
  offline: boolean;
  /** Benutzer-IDs der anderen, die dieses Protokoll gerade geöffnet haben. */
  peers: string[];
  /** Erklärung zum Status (Grund einer Ablehnung, unbekanntes Element …). */
  message: string;
}

/** Darf man im Editor schreiben? */
export const isEditable = (s: SessionStatus): boolean => s === 'ok' || s === 'rejected' || s === 'outdated' || s === 'auth';

export interface SessionOptions {
  store?: HubDb;
  transport: ExchangeTransport;
  /** Läuft vor dem Senden eigener Änderungen (neue Anhänge hochladen). Ein Fehler hält den Austausch nicht auf. */
  beforeSend?: () => Promise<void>;
  /** Fehlende Anhänge, die der Server meldet (hat dieses Gerät sie noch, gehen sie im nächsten Abgleich hoch). */
  onMissingBlobs?: (ids: string[]) => void;
  /** Der Editor verarbeitet gerade eine Eingabe (zum Beispiel die Wortvorschläge der Tastatur): Änderungen anderer warten. */
  busy?: () => boolean;
  /** Der Tab ist sichtbar; im Hintergrund wird nur gesichert, nicht ausgetauscht. */
  visible?: () => boolean;
  /** Die Datenbank des Servers wurde ersetzt: Der Abgleich der Protokolle soll aufräumen. */
  requestSync?: () => void;
  /** Das Dokument wurde durch die Fassung des Servers ersetzt (`replaced`). */
  onReplaced?: () => void;
  intervalMs?: number;
  nudgeMs?: number;
  persistMs?: number;
  /** Pause, bevor ein gescheitertes Sichern auf dem Gerät noch einmal versucht wird. */
  persistRetryMs?: number;
  snapshotMs?: number;
  maxBackoffMs?: number;
}

/** Womit eine Bearbeitung beginnt (bestimmt `openProtocol`). */
export interface SessionStart {
  /** Revision des Protokolls bei der letzten Antwort des Servers zum Text; `undefined`, wenn dieses Gerät sie nicht kennt. */
  rev: number | undefined;
  /** Zählung der gespeicherten Zeile, deren Inhalt das Dokument hat (0: es gibt keine Zeile). */
  seq: number;
  /** Dieses Gerät hat einen gespeicherten Zustand zu diesem Protokoll (gehabt). Verschwindet er unter uns, wurde er verworfen. */
  hadState: boolean;
}

const sessions = new Map<string, CollabSession>();

/** Ist dieses Protokoll gerade in einem Editor geöffnet? Der Hintergrund-Abgleich lässt solche Texte in Ruhe. */
export const isSessionOpen = (id: string): boolean => sessions.has(id);

/** Die offene Bearbeitung dieses Protokolls (zum Beispiel, um vor dem PDF-Export den Text zu senden). */
export const getOpenSession = (id: string): CollabSession | undefined => sessions.get(id);

/** Alle offenen Bearbeitungen. */
export const openSessions = (): CollabSession[] => [...sessions.values()];

type Timer = ReturnType<typeof setTimeout>;

export class CollabSession {
  readonly doc: Y.Doc;
  private readonly store: HubDb;
  private readonly interval: number;
  private readonly nudgeDelay: number;
  private readonly persistDelay: number;
  private readonly persistRetry: number;
  private readonly snapshotDelay: number;
  private readonly maxBackoff: number;
  private pending: Uint8Array[] = [];
  private persisting: Promise<void> = Promise.resolve();
  private persistTimer: Timer | undefined;
  private snapshotTimer: Timer | undefined;
  private exchangeTimer: Timer | undefined;
  private exchangeDue = Infinity;
  private running: Promise<void> = Promise.resolve();
  private failures = 0;
  private knownRev: number | undefined;
  /** Zählung der gespeicherten Zeile, bis zu der dieses Dokument ihren Inhalt kennt, und wie oft diese Bearbeitung seitdem selbst geschrieben hat. */
  private seenSeq: number;
  private ownWrites = 0;
  /** Beim Start ist der Schnappschuss (Liste, Suche) vielleicht veraltet, etwa weil der Text im Hintergrund nachgeladen wurde. */
  private snapshotDue = true;
  private touched = false;
  private destroyed = false;
  private stopped = false;
  private resyncing = false;
  private info: SessionInfo = { status: 'ok', saved: true, offline: false, peers: [], message: '' };
  private readonly listeners = new Set<() => void>();
  private readonly onVisible = () => {
    if (this.isVisible()) this.nudge(0);
  };

  private hadState: boolean;

  constructor(
    readonly id: string,
    doc: Y.Doc,
    start: SessionStart,
    private readonly opts: SessionOptions,
  ) {
    this.doc = doc;
    this.knownRev = start.rev;
    this.seenSeq = start.seq;
    this.hadState = start.hadState;
    this.store = opts.store ?? db;
    this.interval = opts.intervalMs ?? 2500;
    this.nudgeDelay = opts.nudgeMs ?? 800;
    this.persistDelay = opts.persistMs ?? 500;
    this.persistRetry = opts.persistRetryMs ?? 3000;
    this.snapshotDelay = opts.snapshotMs ?? 3000;
    this.maxBackoff = opts.maxBackoffMs ?? 30_000;
    // Änderungen werden ab jetzt gesichert, auch wenn der regelmäßige Austausch (`start`) nicht läuft (Tests steuern ihn von Hand).
    doc.on('update', this.onUpdate);
  }

  // ---------- Zustand für die Oberfläche ----------

  getInfo = (): SessionInfo => this.info;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setInfo(patch: Partial<SessionInfo>): void {
    const next = { ...this.info, ...patch };
    if (next.status === this.info.status && next.saved === this.info.saved && next.offline === this.info.offline && next.message === this.info.message && jsonEqual(next.peers, this.info.peers)) return;
    this.info = next;
    this.listeners.forEach((l) => l());
  }

  private isVisible(): boolean {
    return this.opts.visible ? this.opts.visible() : typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }

  // ---------- Lebenslauf ----------

  /** Beginnt den regelmäßigen Austausch und meldet den Text als geöffnet. */
  start(): void {
    if (this.destroyed) return;
    sessions.set(this.id, this);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
    this.schedule(0);
  }

  /**
   * Die noch nicht gesicherten Änderungen (zusammengefasst), und sie gelten als abgegeben: Der Aufrufer sichert sie selbst. Gebraucht, wenn
   * der Abgleich der Protokolle den Zustand verwirft, während jemand tippt, und vorher eine Kopie anlegt.
   */
  takePending(): Uint8Array | undefined {
    if (!this.pending.length) return undefined;
    const merged = Y.mergeUpdates(this.pending);
    this.pending = [];
    clearTimeout(this.persistTimer);
    this.setInfo({ saved: true });
    return merged;
  }

  /** Sichert alles Offene auf dem Gerät und schreibt den Schnappschuss. */
  async flush(): Promise<void> {
    clearTimeout(this.persistTimer);
    clearTimeout(this.snapshotTimer);
    await this.persist();
    await this.writeSnapshot();
  }

  /** Beendet die Bearbeitung: Offenes sichern, Zustand verdichten, aufhören auszutauschen. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.persistTimer);
    clearTimeout(this.snapshotTimer);
    clearTimeout(this.exchangeTimer);
    this.doc.off('update', this.onUpdate);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
    try {
      // Zuerst sichern, dann warten: Eine Anfrage, die im schlechten Netz hängt, soll nicht verhindern, dass das gleich wieder geöffnete
      // Protokoll (oder ein anderer Tab) die zuletzt getippten Zeichen sieht.
      await this.persist();
      await this.rescuePending();
      await this.running;
      await this.writeSnapshot();
      await compact(this.id, this.store);
    } catch {
      /* Was nicht gesichert werden konnte, liegt nicht auf dem Gerät; der Editor hat die Meldung schon gezeigt. */
    } finally {
      if (sessions.get(this.id) === this) sessions.delete(this.id);
      this.listeners.clear();
    }
  }

  // ---------- Änderungen sichern ----------

  private onUpdate = (update: Uint8Array, origin: unknown): void => {
    this.snapshotDue = true;
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => void this.writeSnapshot().catch(() => undefined), this.snapshotDelay);
    if (origin === REMOTE) return;
    this.touched = true;
    this.pending.push(update);
    this.setInfo({ saved: false });
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persist().catch(() => undefined), this.persistDelay);
    this.nudge(this.nudgeDelay);
  };

  /** Schreibt die vorgemerkten Änderungen in den lokalen Speicher. Läufe sind hintereinandergeschaltet. */
  private persist(): Promise<void> {
    const run = async (): Promise<void> => {
      if (!this.pending.length) return;
      const batch = this.pending;
      this.pending = [];
      // Ein inzwischen gelöschtes Protokoll bekommt keinen Zustand mehr (sonst bliebe er als Waise liegen und zählte als ungesendet).
      if (!(await this.store.protokolle.get(this.id))) return;
      try {
        // Wurde der Zustand unter uns verworfen (Datenbank des Servers ersetzt), entsteht keine Zeile aus nur der letzten Änderung:
        // Sie verwiese auf eine Geschichte, die der Server nicht kennt. Der Text bleibt vorgemerkt; die nächste Runde sichert ihn als Kopie.
        const seq = await putLocal(this.id, Y.mergeUpdates(batch), this.store, this.hadState);
        if (seq === undefined) {
          this.pending = [...batch, ...this.pending];
          return;
        }
        this.ownWrites++;
        this.hadState = true;
      } catch (e) {
        this.pending = [...batch, ...this.pending]; // nicht verlieren: Der nächste Versuch schreibt es mit
        this.setInfo({ saved: false, message: 'Speichern auf diesem Gerät fehlgeschlagen. Das Protokoll bleibt geöffnet, der Abgleich mit dem Server läuft weiter.' });
        this.retryPersist();
        throw e;
      }
      if (!this.pending.length) this.setInfo({ saved: true, ...(this.info.message.startsWith('Speichern auf diesem Gerät') ? { message: '' } : {}) });
    };
    this.persisting = this.persisting.then(run, run);
    return this.persisting;
  }

  /**
   * Gibt es keinen gespeicherten Zustand mehr (verworfen, während der Editor offen war), der Editor aber noch Änderungen im Speicher
   * hat, werden sie samt dem ganzen Text als Kopie „(lokale Fassung)“ gesichert: Eine Zeile aus nur der letzten Änderung wäre wertlos.
   */
  private async rescuePending(): Promise<void> {
    if (!this.pending.length || (await getYRow(this.id, this.store))) return;
    const batch = this.pending;
    await saveLocalCopy(this.id, { doc: this.doc }, this.store);
    this.pending = this.pending.filter((u) => !batch.includes(u));
    if (!this.pending.length) this.setInfo({ saved: true });
  }

  /**
   * Ein gescheitertes Sichern (Speicher voll, Datenbank kurz gesperrt) wird wiederholt, auch wenn niemand weitertippt und kein Austausch
   * mehr läuft (ohne Server, nach dem Sperren des Protokolls): Sonst bliebe der Text bis zur nächsten Eingabe nur im Speicher.
   */
  private retryPersist(): void {
    if (this.destroyed || !this.pending.length) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persist().catch(() => undefined), this.persistRetry);
  }

  /** Schreibt den Text als Schnappschuss in die Zeile des Protokolls (Liste, Suche, Nur-lesen-Ansicht). Nur nach einer Änderung. */
  private async writeSnapshot(): Promise<void> {
    if (!this.snapshotDue) return;
    this.snapshotDue = false;
    let json;
    try {
      json = yDocToJson(this.doc);
    } catch {
      return; // ein Dokument, das kein Editor baut, wird nicht als Schnappschuss ausgegeben
    }
    const row = await this.store.protokolle.get(this.id);
    if (!row) return;
    const same = (isEmptySnapshot(row.content) && isEmptySnapshot(json)) || jsonEqual(row.content, json);
    if (same) return;
    await this.store.protokolle.update(this.id, { content: json, ...(this.touched ? { updatedAt: Date.now() } : {}) });
    this.touched = false;
  }

  // ---------- Austausch ----------

  /** Nächster Austausch frühestens in `ms` (ein früher geplanter bleibt). */
  private schedule(ms: number): void {
    if (this.destroyed || this.stopped) return;
    const due = Date.now() + ms;
    if (this.exchangeTimer !== undefined && this.exchangeDue <= due) return;
    clearTimeout(this.exchangeTimer);
    this.exchangeDue = due;
    this.exchangeTimer = setTimeout(() => void this.tick(), ms);
  }

  private nudge(ms: number): void {
    this.schedule(ms);
  }

  private delay(): number {
    return this.failures ? Math.min(this.interval * 2 ** this.failures, this.maxBackoff) : this.interval;
  }

  private async tick(): Promise<void> {
    this.exchangeTimer = undefined;
    this.exchangeDue = Infinity;
    if (this.destroyed || this.stopped) return;
    if (!this.isVisible()) {
      this.schedule(this.interval); // im Hintergrund nicht austauschen; beim Zurückkehren sofort
      return;
    }
    if (this.opts.busy?.()) {
      this.schedule(300);
      return;
    }
    await this.exchangeNow().catch(() => undefined);
    this.schedule(this.delay());
  }

  /** Eine Runde sofort; Runden laufen nie gleichzeitig. */
  exchangeNow(): Promise<void> {
    const next = this.running.then(() => this.round());
    this.running = next.catch(() => undefined);
    return next;
  }

  /** Eine Runde: eigene Änderungen senden, fremde holen. */
  private async round(): Promise<void> {
    if (this.destroyed || this.stopped) return;
    await this.persist().catch(() => undefined);
    // Ein neues Protokoll, dessen Kopfdaten der Server noch nicht hat, kennt er nicht („gone“): erst abgleichen, dann tauschen wir den Text aus.
    if ((await this.store.protokolle.get(this.id))?.rev === 0) {
      this.opts.requestSync?.();
      return;
    }
    const row = await getYRow(this.id, this.store);
    if (!row && this.hadState) {
      // Der Zustand wurde unter uns verworfen: Die Datenbank des Servers ist eine andere (ersetzt oder wiederhergestellt), und der Abgleich
      // der Protokolle hat die Fassung dieses Geräts, soweit ungesendet, als Kopie gesichert. Dieses Dokument im Speicher ist veraltet;
      // was seitdem hier geschrieben wurde, kommt ebenfalls in eine Kopie.
      await this.rescuePending();
      this.stop('replaced', 'Die Datenbank des Servers wurde ersetzt. Dieses Protokoll wird neu geladen; ungesendete Änderungen liegen als Kopie „(lokale Fassung)“ vor.');
      this.opts.onReplaced?.();
      return;
    }
    // Hat ein anderer Tab oder der Hintergrund-Abgleich auf diesem Gerät etwas gesichert, das dieses Dokument nicht kennt, kommt es zuerst
    // hinein: Sonst fehlte es in dem, was gesendet wird, und die Bestätigung nähme es als gesendet.
    if (row && row.seq !== this.seenSeq + this.ownWrites) {
      if (this.opts.busy?.()) return; // der Editor ist mitten in einer Eingabe: nächste Runde
      const unknown = this.applyRemote(row.update);
      this.seenSeq = row.seq;
      this.ownWrites = 0;
      if (unknown) {
        this.stop('blocked', `Dieses Protokoll enthält Elemente, die diese App-Version nicht kennt (${unknown}). Es wird nur gelesen. Bitte die App aktualisieren.`);
        return;
      }
    }
    const sentSeq = row?.seq ?? 0;
    const sending = (row?.dirty === 1 && !row.rejected) || this.pending.length > 0;
    const req: ExchangeDocRequest = { id: this.id, live: true, sv: bytesToBase64(Y.encodeStateVector(this.doc)) };
    if (sending) {
      const diff = Y.encodeStateAsUpdate(this.doc, row?.serverSv);
      if (!isEmptyUpdate(diff)) req.update = bytesToBase64(diff);
      if (row?.created) req.create = true;
      await this.opts.beforeSend?.().catch(() => undefined);
    } else if (this.knownRev !== undefined) {
      req.rev = this.knownRev;
    }

    let res;
    try {
      res = await this.opts.transport({ docs: [req] });
    } catch (e) {
      this.onError(e);
      return;
    }
    if (this.destroyed) return;
    if (res.reset) {
      this.opts.requestSync?.();
      this.failures++;
      return;
    }
    const r = res.docs.find((d) => d.id === this.id);
    if (!r) return;
    // „Verschoben“ heißt, dass der Server gerade nicht konnte: nicht im Takt der Sekunden nachhaken.
    this.failures = r.status === 'deferred' ? this.failures + 1 : 0;
    this.setInfo({ offline: false });

    switch (r.status) {
      case 'ok': {
        this.resyncing = false;
        const answer = answerOf(r);
        const incoming = answer.update && !isEmptyUpdate(answer.update) ? answer.update : undefined;
        if (incoming && this.opts.busy?.()) return; // der Editor ist mitten in einer Eingabe: nächste Runde
        let blocked: string | null = null;
        if (incoming) blocked = this.applyRemote(incoming);
        // Im Ruhezustand (nichts gesendet, nichts empfangen, gleiche Revision) bleibt der Speicher unberührt.
        // Nur was die Anfrage enthielt (`sending`), gilt als gesendet; ein abgelehnter oder nicht gesendeter Text bleibt vorgemerkt.
        if (sending || incoming || !row || (r.rev !== undefined && r.rev !== this.knownRev)) await applyAnswer(this.id, answer, sending ? sentSeq : undefined, this.store);
        this.knownRev = r.rev ?? this.knownRev;
        if (r.peers) this.setInfo({ peers: r.peers });
        if (r.missingBlobs?.length) this.opts.onMissingBlobs?.(r.missingBlobs);
        if (blocked) this.stop('blocked', `Dieses Protokoll enthält Elemente, die diese App-Version nicht kennt (${blocked}). Es wird nur gelesen. Bitte die App aktualisieren.`);
        else if (this.info.status === 'rejected' && sending) this.setInfo({ status: 'ok', message: '' });
        return;
      }
      case 'gone': {
        await this.persist().catch(() => undefined);
        const current = await getYRow(this.id, this.store);
        // Ungesendete Änderungen gehen nicht verloren: Sie liegen danach als eigenes, privates Protokoll vor.
        if (current?.dirty === 1) await saveLocalCopy(this.id, {}, this.store);
        else if (!current) await this.rescuePending();
        await discard(this.id, this.store);
        this.stop('gone', 'Dieses Protokoll wurde gelöscht oder von jemand anderem zurückgezogen. Änderungen werden nicht mehr gespeichert.');
        return;
      }
      case 'legacy':
        this.stop('legacy', 'Der Server hat den Text dieses Protokolls noch nicht für das gemeinsame Bearbeiten umgestellt. Es wird nur gelesen.');
        return;
      case 'exists': {
        // Der Server hat schon Text mit anderer Geschichte (zum Beispiel aus einer Sicherung auf einem anderen Gerät): die eigene Fassung als Kopie sichern, danach gilt die des Servers.
        await this.persist().catch(() => undefined);
        if (!(await saveLocalCopy(this.id, {}, this.store))) await this.rescuePending();
        await discard(this.id, this.store);
        this.stop('replaced', 'Dieses Protokoll gab es schon auf dem Server. Deine Fassung liegt als Kopie „(lokale Fassung)“ vor.');
        this.opts.onReplaced?.();
        return;
      }
      case 'rejected':
        await markRejected(this.id, r.reason ?? 'abgelehnt', sentSeq, this.store);
        this.setInfo({ status: 'rejected', message: `Der Server nimmt den Text nicht an (${r.reason ?? 'abgelehnt'}). Er bleibt auf diesem Gerät, bis du ihn änderst.` });
        return;
      case 'resync':
        // Das Update setzt Unbekanntes voraus: einmal mit dem ganzen Zustand wiederholen.
        if (this.resyncing) return;
        this.resyncing = true;
        await forgetServerState(this.id, this.store);
        this.knownRev = undefined;
        this.schedule(0);
        return;
      case 'deferred':
        return;
    }
  }

  /**
   * Prüft das Ergebnis auf einer Kopie, bevor das geöffnete Dokument sich ändert. Liefert den Grund, wenn der Editor es nicht bauen könnte.
   * Verstößt das Ergebnis nur gegen die Inhaltsregeln (zwei Personen haben gleichzeitig die letzten Punkte einer Liste gestrichen), werden
   * Update und Ergänzung (`repairDoc`) in *einer* Transaktion angewendet: Der Editor sieht nie den unzulässigen Zwischenstand, den er sonst
   * aus dem geteilten Dokument löschen würde. Die Ergänzung zählt als eigene Änderung dieses Geräts und geht zum Server.
   */
  private applyRemote(update: Uint8Array): string | null {
    const probe = new Y.Doc();
    let repair = false;
    try {
      Y.applyUpdate(probe, Y.encodeStateAsUpdate(this.doc));
      Y.applyUpdate(probe, update);
      const problem = docProblem(probe);
      if (problem) {
        if (!repairDoc(probe) || docProblem(probe)) return problem;
        repair = true;
      }
    } finally {
      probe.destroy();
    }
    if (repair) {
      this.doc.transact(() => {
        Y.applyUpdate(this.doc, update, REMOTE);
        repairDoc(this.doc);
      }, REPAIR);
    } else {
      Y.applyUpdate(this.doc, update, REMOTE);
    }
    return null;
  }

  private onError(e: unknown): void {
    if (e instanceof NoServer) {
      // Ohne Server (Demo im Browser, App ohne Server) gibt es nichts auszutauschen, und das ist kein Fehler: Alles bleibt auf dem Gerät.
      this.stopped = true;
      clearTimeout(this.exchangeTimer);
      return;
    }
    const status = e instanceof ProtoError ? e.status : -1;
    this.failures++;
    if (status === 0) {
      this.setInfo({ offline: true });
    } else if (status === 401) {
      this.stop('auth', 'Nicht angemeldet. Die Änderungen bleiben auf diesem Gerät.', false);
    } else if (status === 426) {
      this.stop('outdated', e instanceof Error ? e.message : 'App oder Server zu alt.', false);
    }
  }

  /** Hört auf auszutauschen. `lock`: Der Editor wird schreibgeschützt. */
  private stop(status: SessionStatus, message: string, lock = true): void {
    this.setInfo({ status, message });
    if (status === 'replaced') {
      // Das Dokument im Speicher ist veraltet: Es darf nicht als Schnappschuss in die Zeile des Protokolls geschrieben werden.
      this.snapshotDue = false;
      clearTimeout(this.snapshotTimer);
    }
    if (lock) {
      this.stopped = true;
      clearTimeout(this.exchangeTimer);
    } else if (status === 'auth' || status === 'outdated') {
      this.stopped = true; // der Abgleich der Protokolle meldet es; ein neuer Start der Bearbeitung versucht es wieder
      clearTimeout(this.exchangeTimer);
    }
  }
}
