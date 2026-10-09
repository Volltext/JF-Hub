import { create } from 'zustand';
import { loadAccount } from '@/core/account/account';
import { db as defaultDb, type HubDb } from '@/core/db/db';
import { newId } from '@/core/domain/id';
import { ProtoError, loadConn, request } from '@/features/protokolle/http';
import type { Draft } from './model';
import { applyPending, enqueue, rebase, type DraftOp, type PendingOp } from './ops';
import { normalizeDraft } from './stopwatch';

/**
 * Live-Stoppuhr: alle Betreuer sehen dieselbe Stoppuhr je Modus, mit laufender Zeit, Zwischenzeiten, Fehlern und Notizen.
 * Gegenstück auf dem Server: server/src/live.ts.
 *
 * - Jede Eingabe wirkt sofort auf diesem Gerät und wird als Datensatz (`PendingOp`) vorgemerkt, auch offline und über
 *   einen Neustart hinweg. Die Oberfläche wartet nie auf das Netz.
 * - Der Server hat je Modus einen bestätigten Stand mit Revision. Das Gerät schickt seinen Stand zusammen mit der
 *   Revision, auf der er beruht. Hat inzwischen jemand anderes geändert, kommt dessen Stand zurück, die offenen
 *   Eingaben werden darauf erneut angewendet (`rebase`) und noch einmal geschickt. Tragen zwei gleichzeitig Fehler
 *   ein, zählen beide; dank der IDs im Stand zählt keine Eingabe doppelt.
 * - Änderungen der anderen kommen per Long-Polling: die Abfrage wartet am Server, bis sich etwas ändert.
 * - Laufende Zeiten stehen als Startzeitpunkt im Stand. Die Uhren der Geräte gehen nie ganz gleich, deshalb wird an
 *   der Grenze zum Server in Server-Zeit umgerechnet (`ClockOffset`). So zeigen alle Geräte dieselbe Zeit.
 */

export interface LiveBy {
  id: string;
  name: string;
}

export interface ServerDraft {
  mode: string;
  rev: number;
  draft: unknown;
  updatedAt: number;
  by: LiveBy | null;
}

export interface PollResponse {
  epoch: string;
  rev: number;
  full: boolean;
  /** Server-Zeit beim Antworten. */
  now: number;
  /** So lange hat der Server auf eine Änderung gewartet (ms). */
  held: number;
  drafts: ServerDraft[];
}

export type PutResponse = ({ accepted: true; rev: number } | { accepted: false; current: ServerDraft | null }) & { now: number };

export interface LiveTransport {
  poll(since: number, epoch: string, wait: boolean): Promise<PollResponse>;
  put(mode: string, baseRev: number, draft: Draft): Promise<PutResponse>;
}

export interface LiveConnection {
  /** Server und Konto; ändert sich das, gilt der bisherige Abgleich-Zustand nicht mehr. */
  key: string;
  accountId: string | null;
  transport: LiveTransport;
}

export type LiveStatus = 'off' | 'connecting' | 'live' | 'offline' | 'auth';

export const useLiveStatus = create<{ status: LiveStatus }>(() => ({ status: 'off' }));

// ---------- Uhrenabgleich ----------

/**
 * Abstand der Server-Uhr zur Gerätezeit, aus den Antwortzeiten geschätzt (wie NTP): Der Server stempelt seine Antwort,
 * sie braucht etwa die halbe Laufzeit bis hierher. Die Messung mit der kürzesten Laufzeit ist die genaueste.
 */
export class ClockOffset {
  private samples: { offset: number; rtt: number }[] = [];

  /** t0/t1: Gerätezeit vor/nach der Anfrage, `serverNow`: Server-Zeit beim Antworten, `held`: so lange hat er gewartet. */
  sample(t0: number, t1: number, serverNow: unknown, held: unknown = 0): void {
    if (typeof serverNow !== 'number' || !Number.isFinite(serverNow)) return;
    const wait = typeof held === 'number' && held > 0 ? held : 0;
    const rtt = Math.max(0, t1 - t0 - wait);
    this.samples = [...this.samples, { offset: Math.round(serverNow + rtt / 2 - t1), rtt }].slice(-8);
  }

  /** Server-Zeit minus Gerätezeit in ms; null, solange es keine Messung gibt. */
  get offset(): number | null {
    if (!this.samples.length) return null;
    return this.samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
  }
}

const shift = (d: Draft, by: number): Draft => (d.startTimestamp === null || !by ? d : { ...d, startTimestamp: d.startTimestamp + by });
/** Stand in Server-Zeit (zum Senden). */
export const toServer = (d: Draft, offset: number): Draft => shift(d, offset);
/** Stand in Gerätezeit (nach dem Empfang). */
export const toLocal = (d: Draft, offset: number): Draft => shift(d, -offset);

// ---------- Speicher ----------

const MODE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DRAFT_KEY = (mode: string) => `draft.${mode}`;
/** kv-Schlüssel des Abgleich-Zustands (gesamt bzw. `draftSync.<modus>`); an Server und Konto gebunden. */
export const LIVE_KV_PREFIX = 'draftSync';
const SYNC_KEY = (mode: string) => `${LIVE_KV_PREFIX}.${mode}`;

interface PersistedEntry {
  account: string;
  base: Draft;
  rev: number;
  epoch: string;
  ops: PendingOp[];
  by: LiveBy | null;
}

interface PersistedState {
  account: string;
  since: number;
  epoch: string;
}

interface Entry {
  mode: string;
  /** Was die Oberfläche zeigt: bestätigter Stand plus offene Eingaben (Zeiten in Gerätezeit). */
  view: Draft;
  /** Zuletzt vom Server bestätigter Stand (in Gerätezeit umgerechnet). */
  base: Draft;
  /** Revision von `base`; 0 = der Server kennt den Modus (noch) nicht. */
  rev: number;
  /** Eingaben, die der Server noch nicht bestätigt hat, in der Reihenfolge, in der sie gemacht wurden. */
  ops: PendingOp[];
  by: LiveBy | null;
  /** IDs der Eingaben, die gerade zum Server unterwegs sind. */
  inFlight: Set<string> | null;
  /** Abgelehnte Schreibversuche in Folge (gleichzeitige Änderungen); begrenzt, damit nichts im Kreis läuft. */
  conflicts: number;
}

const NOTHING: ReadonlySet<string> = new Set();
const MAX_CONFLICTS = 10;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function httpConnect(): Promise<LiveConnection | null> {
  const conn = await loadConn();
  if (!conn.url || !conn.token) return null;
  const account = await loadAccount();
  return {
    key: `${conn.url}|${account?.id ?? ''}`,
    accountId: account?.id ?? null,
    transport: {
      poll: (since, epoch, wait) =>
        request<PollResponse>(conn, 'GET', `/api/live?since=${since}&epoch=${encodeURIComponent(epoch)}${wait ? '' : '&wait=0'}`),
      put: (mode, baseRev, draft) => request<PutResponse>(conn, 'PUT', `/api/live/${encodeURIComponent(mode)}`, { baseRev, draft }),
    },
  };
}

export interface LiveEngineOptions {
  db?: HubDb;
  /** Verbindung zum Server; null = kein Server eingerichtet (die Stoppuhr bleibt dann auf diesem Gerät). */
  connect?: () => Promise<LiveConnection | null>;
  now?: () => number;
  /** Erste Wartezeit vor einem neuen Versuch (verdoppelt sich bis 15 s bzw. 30 s). */
  retryMs?: number;
}

export class LiveEngine {
  private readonly db: HubDb;
  private readonly connect: () => Promise<LiveConnection | null>;
  private readonly now: () => number;
  private readonly retryMs: number;

  private entries = new Map<string, Entry>();
  private loading = new Map<string, Promise<Entry>>();
  private listeners = new Map<string, Set<() => void>>();
  /** undefined = noch nicht geprüft. */
  private conn: LiveConnection | null | undefined;
  private connecting: Promise<LiveConnection | null> | null = null;
  /** Älterer Server ohne Live-Stoppuhr: dann bleibt alles auf dem Gerät wie früher. */
  private unsupported = false;
  private state: PersistedState | null = null;
  private clock = new ClockOffset();
  private users = 0;
  private gen = 0;
  private dirty = new Set<string>();
  private stateDirty = false;
  private writing: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay: number;

  constructor(opts: LiveEngineOptions = {}) {
    this.db = opts.db ?? defaultDb;
    this.connect = opts.connect ?? httpConnect;
    this.now = opts.now ?? (() => Date.now());
    this.retryMs = opts.retryMs ?? 1000;
    this.retryDelay = this.retryMs;
  }

  // ---------- Schnittstelle für die Oberfläche ----------

  /** Lädt den Stand eines Modus (aus dem Gerätespeicher; Server-Änderungen kommen über `subscribe`). */
  async load(mode: string): Promise<Draft> {
    return (await this.entry(mode)).view;
  }

  /** Aktueller Stand, falls schon geladen. Bleibt dasselbe Objekt, bis sich etwas ändert. */
  peek(mode: string): Draft | null {
    return this.entries.get(mode)?.view ?? null;
  }

  subscribe(mode: string, fn: () => void): () => void {
    let set = this.listeners.get(mode);
    if (!set) this.listeners.set(mode, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  /** Name des Betreuers, der die Stoppuhr zuletzt geändert hat, wenn es nicht dieses Konto war. */
  editor(mode: string): string | null {
    const by = this.entries.get(mode)?.by;
    return by && by.name && by.id !== this.conn?.accountId ? by.name : null;
  }

  /** Zahl der Eingaben, die noch nicht beim Server sind. */
  pending(mode: string): number {
    return this.entries.get(mode)?.ops.length ?? 0;
  }

  /**
   * Wendet eine Eingabe an (sofort, auch offline) und schickt sie an den Server. `session` bindet sie an einen
   * bestimmten Lauf, z. B. „diesen Lauf zurücksetzen“ nach einer Rückfrage, während der ein anderer schon neu begonnen hat.
   */
  dispatch(mode: string, op: DraftOp, session?: string): void {
    const e = this.entries.get(mode);
    if (!e) return;
    const p: PendingOp = { id: newId(), session: session ?? e.view.id, at: this.now(), op };
    const next = applyPending(e.view, p);
    if (next === e.view) return;
    e.view = next;
    if (this.syncing()) {
      e.ops = enqueue(e.ops, p, e.inFlight ?? NOTHING);
    } else {
      e.base = next;
      e.ops = [];
    }
    this.changed(e);
    this.push(e);
  }

  /**
   * Hält die Verbindung, solange die Stoppuhr offen ist (mehrfach aufrufbar). Liefert die Funktion zum Beenden.
   */
  start(): () => void {
    this.users++;
    if (this.users === 1) {
      this.unsupported = false;
      this.restart();
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onWake);
      if (typeof window !== 'undefined') window.addEventListener('online', this.onWake);
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      if (--this.users > 0) return;
      this.gen++;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onWake);
      if (typeof window !== 'undefined') window.removeEventListener('online', this.onWake);
    };
  }

  /**
   * Schickt vorgemerkte Eingaben, auch wenn die Stoppuhr gerade nicht offen ist (vom allgemeinen Abgleich aufgerufen):
   * wer offline „Stopp“ getippt und die Seite verlassen hat, soll die anderen nicht mit laufender Uhr zurücklassen.
   */
  async flush(): Promise<void> {
    if (this.users) return;
    try {
      const c = await this.refresh();
      if (!c) return;
      const rows = await this.db.kv.where('key').startsWith(`${LIVE_KV_PREFIX}.`).toArray();
      for (const r of rows) {
        const mode = r.key.slice(LIVE_KV_PREFIX.length + 1);
        if (MODE_RE.test(mode) && (r.value as PersistedEntry | undefined)?.ops?.length) await this.entry(mode);
      }
      if (![...this.entries.values()].some((e) => e.ops.length)) return;
      this.unsupported = false;
      await this.pollOnce(c, false);
      this.pushAll();
    } catch (err) {
      this.failed(err);
    }
  }

  /** Wartet, bis alles im Gerätespeicher steht (Tests). */
  async idle(): Promise<void> {
    while (this.writing) await this.writing;
  }

  /** Beendet Verbindung und Wiederholungen (Tests). */
  dispose(): void {
    this.users = 0;
    this.gen++;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  // ---------- Verbindung ----------

  private syncing(): boolean {
    return !!this.conn && !this.unsupported;
  }

  private key(): string {
    return this.conn?.key ?? '';
  }

  /** Prüft Server und Konto. Wechseln sie, gilt der bisherige Abgleich-Zustand nicht mehr. */
  private refresh(): Promise<LiveConnection | null> {
    this.connecting ??= this.connect()
      .then((c) => {
        if (this.conn !== undefined && (this.conn?.key ?? '') !== (c?.key ?? '')) this.forget();
        this.conn = c;
        return c;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  /** Nach Abmelden oder Kontowechsel: nichts vom alten Konto weiterverwenden (die Anzeige lädt neu). */
  private forget(): void {
    this.entries.clear();
    this.loading.clear();
    this.dirty.clear();
    this.state = null;
    this.stateDirty = false;
    this.clock = new ClockOffset();
    for (const mode of this.listeners.keys()) void this.entry(mode).catch(() => undefined);
  }

  private onWake = () => {
    if (this.users && (typeof document === 'undefined' || document.visibilityState === 'visible')) this.restart();
  };

  private restart(): void {
    const gen = ++this.gen;
    void this.loop(gen);
  }

  private setStatus(status: LiveStatus): void {
    useLiveStatus.setState({ status });
  }

  /** Abfrageschleife, solange die Stoppuhr offen ist. Die erste Abfrage kommt sofort zurück (frischer Stand und Uhrzeit). */
  private async loop(gen: number): Promise<void> {
    let quick = true;
    let delay = this.retryMs;
    this.setStatus('connecting');
    while (gen === this.gen) {
      try {
        const c = await this.refresh();
        if (gen !== this.gen) return;
        if (!c) return this.setStatus('off');
        const t0 = this.now();
        const res = await this.pollOnce(c, !quick, gen);
        if (gen !== this.gen) return;
        if (!res) continue; // Konto gewechselt
        this.setStatus('live');
        this.retryDelay = this.retryMs;
        this.pushAll();
        // Schutz gegen eine Schleife, falls ein Proxy die wartende Abfrage sofort beantwortet.
        if (!quick && !res.drafts.length && this.now() - t0 < 1000) await sleep(this.retryMs);
        quick = false;
        delay = this.retryMs;
      } catch (err) {
        if (gen !== this.gen) return;
        const status = err instanceof ProtoError ? err.status : 0;
        if (status === 401) return this.setStatus('auth');
        if (status === 404) return this.unsupport();
        this.setStatus('offline');
        await sleep(delay);
        delay = Math.min(delay * 2, 15_000);
        quick = true;
      }
    }
  }

  /** Eine Abfrage samt Übernahme. null, wenn sich währenddessen Server oder Konto geändert haben. */
  private async pollOnce(c: LiveConnection, wait: boolean, gen?: number): Promise<PollResponse | null> {
    const state = await this.loadState();
    const t0 = this.now();
    const res = await c.transport.poll(state.since, state.epoch, wait);
    if (this.key() !== c.key || (gen !== undefined && gen !== this.gen)) return null;
    this.clock.sample(t0, this.now(), res.now, res.held);
    await this.applyPoll(res);
    return res;
  }

  private async applyPoll(res: PollResponse): Promise<void> {
    const state = await this.loadState();
    if (res.full || res.epoch !== state.epoch) {
      // Neue, zurückgesetzte oder wiederhergestellte Datenbank: bisherige Revisionen gelten nicht mehr.
      state.epoch = res.epoch;
      for (const e of this.entries.values()) e.rev = 0;
    }
    for (const row of res.drafts ?? []) {
      if (typeof row?.mode !== 'string' || !MODE_RE.test(row.mode) || typeof row.rev !== 'number') continue;
      const e = await this.entry(row.mode);
      if (row.rev <= e.rev) continue;
      this.adopt(e, row);
      this.settle(e);
    }
    state.since = typeof res.rev === 'number' ? res.rev : state.since;
    for (const e of this.entries.values()) e.conflicts = 0;
    this.stateDirty = true;
    this.schedulePersist();
  }

  /** Übernimmt einen Server-Stand als neue Grundlage (umgerechnet in Gerätezeit). */
  private adopt(e: Entry, row: ServerDraft): void {
    e.base = toLocal(normalizeDraft(e.mode, row.draft), this.clock.offset ?? 0);
    e.rev = row.rev;
    e.by = row.by ?? null;
  }

  /** Offene Eingaben neu auf die Grundlage setzen und anzeigen. */
  private settle(e: Entry): void {
    const { draft, ops } = rebase(e.base, e.ops);
    e.ops = ops;
    e.view = draft;
    this.changed(e);
  }

  private pushAll(): void {
    for (const e of this.entries.values()) this.push(e);
  }

  /** Schickt den Stand eines Modus, wenn Eingaben offen sind (immer nur eine Anfrage je Modus unterwegs). */
  private push(e: Entry): void {
    const c = this.conn;
    const offset = this.clock.offset;
    // Ohne Uhrenabgleich würde eine laufende Zeit um die Gangabweichung des Geräts verschoben ankommen.
    if (!c || this.unsupported || e.inFlight || !e.ops.length || offset === null || e.conflicts >= MAX_CONFLICTS) return;
    const sent = e.view;
    const ids = new Set(e.ops.map((o) => o.id));
    e.inFlight = ids;
    const t0 = this.now();
    c.transport.put(e.mode, e.rev, toServer(sent, offset)).then(
      (res) => {
        this.clock.sample(t0, this.now(), res.now);
        // Nach einem Kontowechsel gehört der Eintrag nicht mehr dazu (die Verbindung selbst wird bei jeder Abfrage neu geholt).
        if (this.key() !== c.key || this.entries.get(e.mode) !== e) return;
        e.inFlight = null;
        if (res.accepted) {
          e.conflicts = 0;
          this.retryDelay = this.retryMs;
          e.ops = e.ops.filter((o) => !ids.has(o.id));
          if (res.rev > e.rev) {
            e.base = sent;
            e.rev = res.rev;
            e.by = { id: c.accountId ?? '', name: '' };
          }
        } else {
          // Jemand war schneller: auf dessen Stand aufsetzen und erneut schicken.
          e.conflicts++;
          if (!res.current) e.rev = 0;
          else if (res.current.rev > e.rev) this.adopt(e, res.current);
        }
        this.settle(e);
        this.push(e);
      },
      (err) => {
        if (this.entries.get(e.mode) === e) e.inFlight = null;
        this.failed(err);
      },
    );
  }

  private failed(err: unknown): void {
    const status = err instanceof ProtoError ? err.status : 0;
    if (status === 401) return this.setStatus('auth');
    if (status === 404) return this.unsupport();
    if (this.users) this.setStatus('offline');
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.pushAll();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
  }

  /** Der Server kennt die Live-Stoppuhr nicht (ältere Version): weiter wie bisher nur auf diesem Gerät. */
  private unsupport(): void {
    this.unsupported = true;
    this.setStatus('off');
    for (const e of this.entries.values()) {
      e.base = e.view;
      e.ops = [];
      e.inFlight = null;
      this.changed(e);
    }
  }

  // ---------- Gerätespeicher ----------

  private async loadState(): Promise<PersistedState> {
    if (!this.state) {
      const v = (await this.db.kv.get(LIVE_KV_PREFIX))?.value as Partial<PersistedState> | undefined;
      const ok = !!v && v.account === this.key();
      this.state ??= {
        account: this.key(),
        since: ok && typeof v.since === 'number' ? v.since : 0,
        epoch: ok && typeof v.epoch === 'string' ? v.epoch : '',
      };
    }
    return this.state;
  }

  private entry(mode: string): Promise<Entry> {
    const e = this.entries.get(mode);
    if (e) return Promise.resolve(e);
    let p = this.loading.get(mode);
    if (!p) {
      p = this.read(mode).finally(() => this.loading.delete(mode));
      this.loading.set(mode, p);
    }
    return p;
  }

  private async read(mode: string): Promise<Entry> {
    if (this.conn === undefined) await this.refresh();
    const state = await this.loadState();
    const [d, s] = await this.db.kv.bulkGet([DRAFT_KEY(mode), SYNC_KEY(mode)]);
    const existing = this.entries.get(mode);
    if (existing) return existing;
    const local = normalizeDraft(mode, d?.value);
    const p = s?.value as PersistedEntry | undefined;
    let entry: Entry = { mode, view: local, base: local, rev: 0, ops: [], by: null, inFlight: null, conflicts: 0 };
    // Abgleich-Zustand nur übernehmen, wenn er zu diesem Server und Konto gehört.
    if (p && p.account === this.key() && p.base) {
      const base = normalizeDraft(mode, p.base);
      const { draft, ops } = rebase(base, Array.isArray(p.ops) ? p.ops : []);
      entry = { ...entry, view: draft, base, rev: p.epoch === state.epoch ? p.rev : 0, ops, by: p.by ?? null };
    }
    this.entries.set(mode, entry);
    for (const fn of this.listeners.get(mode) ?? []) fn();
    return entry;
  }

  private changed(e: Entry): void {
    for (const fn of this.listeners.get(e.mode) ?? []) fn();
    this.dirty.add(e.mode);
    this.schedulePersist();
  }

  /** Schreibt im Hintergrund, immer den neuesten Stand (schnelle Folgeänderungen werden zusammengefasst). */
  private schedulePersist(): void {
    if (this.writing) return;
    this.writing = (async () => {
      try {
        while (this.dirty.size || this.stateDirty) {
          const rows: { key: string; value: unknown }[] = [];
          for (const mode of this.dirty) {
            const e = this.entries.get(mode);
            if (!e) continue;
            rows.push({ key: DRAFT_KEY(mode), value: e.view });
            const entry: PersistedEntry = { account: this.key(), base: e.base, rev: e.rev, epoch: this.state?.epoch ?? '', ops: e.ops, by: e.by };
            rows.push({ key: SYNC_KEY(mode), value: entry });
          }
          this.dirty.clear();
          if (this.stateDirty && this.state) rows.push({ key: LIVE_KV_PREFIX, value: { ...this.state, account: this.key() } });
          this.stateDirty = false;
          try {
            await this.db.kv.bulkPut(rows);
          } catch {
            /* Speicher voll o. ä.: der nächste Stand versucht es erneut */
          }
        }
      } finally {
        this.writing = null;
      }
    })();
  }
}

/** Die Live-Stoppuhr der App. */
export const live = new LiveEngine();
