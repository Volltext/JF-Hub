import * as Y from 'yjs';
import { db, type HubDb } from '@/core/db/db';
import { bytesToBase64 } from '@/core/domain/base64';
import { jsonEqual } from '@/core/domain/equal';
import { ProtoError } from '../http';
import { isEmptySnapshot } from './base';
import { saveLocalCopy } from './localCopy';
import { answerOf, type ExchangeDocRequest, type ExchangeTransport } from './wire';
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
  snapshotMs?: number;
  maxBackoffMs?: number;
}

const sessions = new Map<string, CollabSession>();

/** Ist dieses Protokoll gerade in einem Editor geöffnet? Der Hintergrund-Abgleich lässt solche Texte in Ruhe. */
export const isSessionOpen = (id: string): boolean => sessions.has(id);

/** Die offene Bearbeitung dieses Protokolls (zum Beispiel, um vor dem PDF-Export den Text zu senden). */
export const getOpenSession = (id: string): CollabSession | undefined => sessions.get(id);

type Timer = ReturnType<typeof setTimeout>;

export class CollabSession {
  readonly doc: Y.Doc;
  private readonly store: HubDb;
  private readonly interval: number;
  private readonly nudgeDelay: number;
  private readonly persistDelay: number;
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
  private snapshotDue = false;
  private touched = false;
  private destroyed = false;
  private stopped = false;
  private resyncing = false;
  private info: SessionInfo = { status: 'ok', saved: true, offline: false, peers: [], message: '' };
  private readonly listeners = new Set<() => void>();
  private readonly onVisible = () => {
    if (this.isVisible()) this.nudge(0);
  };

  constructor(
    readonly id: string,
    doc: Y.Doc,
    knownRev: number | undefined,
    private readonly opts: SessionOptions,
  ) {
    this.doc = doc;
    this.knownRev = knownRev;
    this.store = opts.store ?? db;
    this.interval = opts.intervalMs ?? 2500;
    this.nudgeDelay = opts.nudgeMs ?? 800;
    this.persistDelay = opts.persistMs ?? 500;
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
      await this.running;
      await this.persist();
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
        await putLocal(this.id, Y.mergeUpdates(batch), this.store);
      } catch (e) {
        this.pending = [...batch, ...this.pending]; // nicht verlieren: Der nächste Versuch schreibt es mit
        this.setInfo({ saved: false, message: 'Speichern auf diesem Gerät fehlgeschlagen. Das Protokoll bleibt geöffnet, der Abgleich mit dem Server läuft weiter.' });
        throw e;
      }
      if (!this.pending.length) this.setInfo({ saved: true, ...(this.info.message.startsWith('Speichern auf diesem Gerät') ? { message: '' } : {}) });
    };
    this.persisting = this.persisting.then(run, run);
    return this.persisting;
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
    this.failures = 0;
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
        if (sending || incoming || !row || (r.rev !== undefined && r.rev !== this.knownRev)) await applyAnswer(this.id, answer, sentSeq, this.store);
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
        await saveLocalCopy(this.id, {}, this.store);
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

  /** Prüft das Ergebnis auf einer Kopie, bevor das geöffnete Dokument sich ändert. Liefert den Grund, wenn der Editor es nicht bauen könnte. */
  private applyRemote(update: Uint8Array): string | null {
    const probe = new Y.Doc();
    try {
      Y.applyUpdate(probe, Y.encodeStateAsUpdate(this.doc));
      Y.applyUpdate(probe, update);
      const problem = docProblem(probe);
      if (problem) return problem;
    } finally {
      probe.destroy();
    }
    Y.applyUpdate(this.doc, update, REMOTE);
    return null;
  }

  private onError(e: unknown): void {
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
    if (lock) {
      this.stopped = true;
      clearTimeout(this.exchangeTimer);
    } else if (status === 'auth' || status === 'outdated') {
      this.stopped = true; // der Abgleich der Protokolle meldet es; ein neuer Start der Bearbeitung versucht es wieder
      clearTimeout(this.exchangeTimer);
    }
  }
}
