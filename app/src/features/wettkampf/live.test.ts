import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubDb } from '@/core/db/db';
import { ProtoError } from '@/features/protokolle/http';
import { LiveEngine, useLiveStatus, type LiveBy, type LiveTransport, type PollResponse, type PutResponse } from './live';
import type { Draft } from './model';
import { elapsedOf, emptyDraft, nextSessionId } from './stopwatch';

/** Nachbau von server/src/live.ts im Speicher, mit eigener (verstellbarer) Uhr. */
class FakeServer {
  epoch = 'epoche-1';
  rev = 0;
  skew = 0;
  rows = new Map<string, { rev: number; draft: unknown; by: LiveBy }>();
  waiters = new Set<() => void>();
  puts = 0;
  now = () => Date.now() + this.skew;

  read(since: number, epoch: string): Omit<PollResponse, 'now' | 'held'> {
    const full = epoch !== this.epoch || since > this.rev;
    const drafts = [...this.rows]
      .filter(([, r]) => full || r.rev > since)
      .map(([mode, r]) => ({ mode, rev: r.rev, draft: structuredClone(r.draft), updatedAt: 0, by: r.by }))
      .sort((a, b) => a.rev - b.rev);
    return { epoch: this.epoch, rev: this.rev, full, drafts };
  }

  wake() {
    for (const w of [...this.waiters]) w();
  }
}

const offline = () => new ProtoError('Keine Verbindung zum Server.', 0);
/** Netzlaufzeit: Antworten kommen nicht im selben Augenblick an, in dem der Server sie schickt. */
const LATENCY_MS = 5;
const net = () => new Promise((r) => setTimeout(r, LATENCY_MS));

/** Ein Gerät mit eigenem Speicher, eigener Uhr und eigener Verbindung. */
function device(server: FakeServer, account: string, skew = 0) {
  const db = new HubDb(`live-test-${account}-${Math.random()}`);
  const cuts = new Set<(e: unknown) => void>();
  const dev = {
    online: true,
    account: account as string | null,
    status: 200,
    /** Die nächste Schreib-Antwort geht verloren, nachdem der Server gespeichert hat (Funkloch). */
    loseNextResponse: false,
  };
  const transport: LiveTransport = {
    poll: (since, epoch, wait) =>
      new Promise<PollResponse>((resolve, reject) => {
        if (!dev.online) return reject(offline());
        if (dev.status !== 200) return reject(new ProtoError('Fehler', dev.status));
        const t0 = server.now();
        const cleanup = () => {
          server.waiters.delete(finish);
          cuts.delete(cut);
        };
        const finish = () => {
          cleanup();
          const res = { ...server.read(since, epoch), now: server.now(), held: server.now() - t0 };
          void net().then(() => resolve(res));
        };
        const cut = (e: unknown) => {
          cleanup();
          reject(e);
        };
        const r = server.read(since, epoch);
        if (!wait || r.full || r.drafts.length) return finish();
        server.waiters.add(finish);
        cuts.add(cut);
      }),
    put: async (mode, baseRev, draft): Promise<PutResponse> => {
      if (!dev.online) throw offline();
      if (dev.status !== 200) throw new ProtoError('Fehler', dev.status);
      server.puts++;
      const row = server.rows.get(mode);
      if ((row?.rev ?? 0) !== baseRev) {
        const res = { accepted: false as const, current: row ? { mode, rev: row.rev, draft: structuredClone(row.draft), updatedAt: 0, by: row.by } : null, now: server.now() };
        await net();
        return res;
      }
      const rev = ++server.rev;
      server.rows.set(mode, { rev, draft: structuredClone(draft), by: { id: account, name: account.toUpperCase() } });
      server.wake();
      const res = { accepted: true as const, rev, now: server.now() };
      await net();
      if (dev.loseNextResponse) {
        dev.loseNextResponse = false;
        throw offline();
      }
      return res;
    },
  };
  const now = () => Date.now() + skew;
  const make = () =>
    new LiveEngine({
      db,
      now,
      retryMs: 20,
      connect: async () => (dev.account === null ? null : { key: `server|${dev.account}`, accountId: dev.account, transport }),
    });
  const d = {
    db,
    now,
    dev,
    engine: make(),
    stop: () => undefined as void,
    /** Verbindet wie eine offene Stoppuhr und wartet, bis der Stand eines Modus geladen ist. */
    async open(mode = 'a') {
      d.stop = d.engine.start();
      await d.engine.load(mode);
    },
    /** Neustart der App: neue Engine auf demselben Gerätespeicher. */
    async restart() {
      d.stop();
      await d.engine.idle();
      d.engine.dispose();
      d.engine = make();
      engines.push(d.engine);
    },
    setOnline(v: boolean) {
      dev.online = v;
      if (!v) for (const c of [...cuts]) c(offline());
    },
    view: (mode = 'a') => d.engine.peek(mode)!,
  };
  engines.push(d.engine);
  return d;
}

const engines: LiveEngine[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
});

const waitFor = (fn: () => void | Promise<void>) => vi.waitFor(fn, { timeout: 3000, interval: 10 });
/** Was der Server für einen Modus gespeichert hat. */
const onServer = (server: FakeServer, mode = 'a') => server.rows.get(mode)?.draft as Draft | undefined;
/** Beide Geräte zeigen denselben, vom Server bestätigten Stand. */
const inSync = (a: { view: () => Draft; engine: LiveEngine }, b: { view: () => Draft; engine: LiveEngine }) =>
  waitFor(() => {
    expect(a.engine.pending('a') + b.engine.pending('a')).toBe(0);
    expect(b.view()).toEqual(a.view());
  });
/** Beide verbunden und mit Uhrenabgleich. */
const connected = async (...devs: { engine: LiveEngine }[]) =>
  waitFor(() => {
    for (const d of devs) expect((d.engine as unknown as { clock: { offset: number | null } }).clock.offset).not.toBeNull();
  });

describe('Live-Stoppuhr zwischen Geräten', () => {
  it('Start auf einem Gerät läuft sofort auf dem anderen mit – trotz falsch gehender Uhren', async () => {
    const server = new FakeServer();
    server.skew = 1500;
    const anna = device(server, 'anna', -3000);
    const tobias = device(server, 'tobias', 5000);
    await anna.open();
    await tobias.open();
    await connected(anna, tobias);

    anna.engine.dispatch('a', { type: 'start' });
    await waitFor(() => expect(tobias.view().isRunning).toBe(true));
    // Dieselbe laufende Zeit auf beiden Geräten (gleicher Augenblick, jeweils mit der eigenen Uhr gerechnet).
    const ea = elapsedOf(anna.view(), anna.now());
    const et = elapsedOf(tobias.view(), tobias.now());
    expect(Math.abs(ea - et)).toBeLessThan(50);
    expect(tobias.engine.editor('a')).toBe('ANNA');
    expect(anna.engine.editor('a')).toBeNull();

    tobias.engine.dispatch('a', { type: 'stop' });
    await waitFor(() => expect(anna.view().isRunning).toBe(false));
    expect(anna.view().elapsedMs).toBe(tobias.view().elapsedMs);
    // Auch gespeichert (übersteht einen Neustart, zeigt laufende Modi in der Übersicht).
    await anna.engine.idle();
    expect(((await anna.db.kv.get('draft.a'))?.value as Draft).elapsedMs).toBe(tobias.view().elapsedMs);
  });

  it('gleichzeitige Eingaben gehen nicht verloren und zählen nicht doppelt', async () => {
    const server = new FakeServer();
    const anna = device(server, 'anna');
    const tobias = device(server, 'tobias');
    await anna.open();
    await tobias.open();
    await connected(anna, tobias);
    anna.engine.dispatch('a', { type: 'set', patch: { scoringEnabled: true } });
    await waitFor(() => expect(tobias.view().scoringEnabled).toBe(true));

    // Tobias ist kurz weg und trägt einen Fehler ein, Anna gleichzeitig einen anderen.
    tobias.setOnline(false);
    tobias.engine.dispatch('a', { type: 'fehler', errorId: 'a-q-psa', delta: 1 });
    anna.engine.dispatch('a', { type: 'fehler', errorId: 'a-q-knoten', delta: 1 });
    anna.engine.dispatch('a', { type: 'fehler', errorId: 'a-q-knoten', delta: 1 });
    await waitFor(() => expect(onServer(server)?.fehlerCounts).toEqual({ 'a-q-knoten': 2 }));
    tobias.setOnline(true);

    const expected = { 'a-q-psa': 1, 'a-q-knoten': 2 };
    await waitFor(() => {
      expect(anna.engine.pending('a') + tobias.engine.pending('a')).toBe(0);
      expect(anna.view().fehlerCounts).toEqual(expected);
      expect(tobias.view().fehlerCounts).toEqual(expected);
    });
    expect(onServer(server)?.fehlerCounts).toEqual(expected);
  });

  it('geht die Antwort verloren, obwohl der Server gespeichert hat, zählt die Eingabe trotzdem nur einmal', async () => {
    const server = new FakeServer();
    const anna = device(server, 'anna');
    const tobias = device(server, 'tobias');
    await anna.open();
    await tobias.open();
    await connected(anna, tobias);
    tobias.setOnline(false);
    anna.dev.loseNextResponse = true;
    anna.engine.dispatch('a', { type: 'fehler', errorId: 'a-q-psa', delta: 1 });
    // Tobias schreibt auf den Stand mit Annas Fehler, bevor Anna ihren nächsten Versuch schickt.
    await waitFor(() => expect(onServer(server)?.fehlerCounts).toEqual({ 'a-q-psa': 1 }));
    tobias.setOnline(true);
    tobias.engine.dispatch('a', { type: 'fehler', errorId: 'a-q-knoten', delta: 1 });

    const expected = { 'a-q-psa': 1, 'a-q-knoten': 1 };
    await waitFor(() => {
      expect(anna.engine.pending('a') + tobias.engine.pending('a')).toBe(0);
      expect(anna.view().fehlerCounts).toEqual(expected);
      expect(tobias.view().fehlerCounts).toEqual(expected);
      expect((server.rows.get('a')!.draft as Draft).fehlerCounts).toEqual(expected);
    });
  });

  it('offline gestoppt: die Eingabe übersteht einen Neustart und kommt nach', async () => {
    const server = new FakeServer();
    const anna = device(server, 'anna');
    const tobias = device(server, 'tobias');
    await anna.open();
    await tobias.open();
    await connected(anna, tobias);
    anna.engine.dispatch('a', { type: 'start' });
    await waitFor(() => expect(tobias.view().isRunning).toBe(true));

    anna.setOnline(false);
    await new Promise((r) => setTimeout(r, 30));
    anna.engine.dispatch('a', { type: 'stop' });
    const stoppedAt = anna.view().elapsedMs;
    expect(anna.engine.pending('a')).toBe(1);
    await anna.restart();
    await anna.open();
    expect(anna.view()).toMatchObject({ isRunning: false, elapsedMs: stoppedAt });
    expect(tobias.view().isRunning).toBe(true);

    anna.setOnline(true);
    await waitFor(() => {
      expect(tobias.view()).toMatchObject({ isRunning: false, elapsedMs: stoppedAt });
      expect(anna.engine.pending('a')).toBe(0);
    });
  });

  it('offene Eingaben gehen auch raus, wenn die Stoppuhr nicht offen ist (allgemeiner Abgleich)', async () => {
    const server = new FakeServer();
    const anna = device(server, 'anna');
    const tobias = device(server, 'tobias');
    await anna.open();
    await tobias.open();
    await connected(anna, tobias);
    anna.engine.dispatch('a', { type: 'start' });
    await waitFor(() => expect(tobias.view().isRunning).toBe(true));
    anna.setOnline(false);
    anna.engine.dispatch('a', { type: 'stop' });
    anna.stop(); // Seite verlassen
    await anna.restart(); // und App neu gestartet

    anna.setOnline(true);
    await anna.engine.flush();
    await waitFor(() => expect(tobias.view().isRunning).toBe(false));
  });

  it('beide speichern gleichzeitig: ein neuer Lauf, und der Start danach zählt', async () => {
    const server = new FakeServer();
    const anna = device(server, 'anna');
    const tobias = device(server, 'tobias');
    await anna.open();
    await tobias.open();
    await connected(anna, tobias);
    anna.engine.dispatch('a', { type: 'start' });
    await new Promise((r) => setTimeout(r, 5));
    anna.engine.dispatch('a', { type: 'stop' });
    await inSync(anna, tobias);
    const lauf = anna.view().id;

    tobias.setOnline(false);
    anna.engine.dispatch('a', { type: 'reset' }, lauf);
    tobias.engine.dispatch('a', { type: 'reset' }, lauf);
    tobias.engine.dispatch('a', { type: 'start' });
    await waitFor(() => expect(onServer(server)?.id).toBe(nextSessionId(lauf)));
    tobias.setOnline(true);

    await waitFor(() => expect(anna.view().isRunning).toBe(true));
    expect(anna.view().id).toBe(nextSessionId(lauf));
    expect(tobias.view().id).toBe(nextSessionId(lauf));
  });

  it('Zurücksetzen eines alten Laufs löscht keinen neuen', async () => {
    const server = new FakeServer();
    const anna = device(server, 'anna');
    const tobias = device(server, 'tobias');
    await anna.open();
    await tobias.open();
    await connected(anna, tobias);
    anna.engine.dispatch('a', { type: 'start' });
    await new Promise((r) => setTimeout(r, 5));
    anna.engine.dispatch('a', { type: 'stop' });
    await inSync(anna, tobias);
    const alt = tobias.view().id;

    // Tobias fragt noch „Wirklich zurücksetzen?“, Anna speichert inzwischen und startet den nächsten Lauf.
    tobias.setOnline(false);
    anna.engine.dispatch('a', { type: 'reset' }, alt);
    anna.engine.dispatch('a', { type: 'start' });
    await waitFor(() => expect(onServer(server)).toMatchObject({ id: nextSessionId(alt), isRunning: true }));
    tobias.engine.dispatch('a', { type: 'reset' }, alt);
    tobias.setOnline(true);

    await waitFor(() => expect(tobias.view()).toMatchObject({ id: nextSessionId(alt), isRunning: true }));
    expect(tobias.engine.pending('a')).toBe(0);
    expect(onServer(server)).toMatchObject({ id: nextSessionId(alt), isRunning: true });
    expect(anna.view().isRunning).toBe(true);
  });

  it('neue Epoche (Server zurückgesetzt oder wiederhergestellt): der Server-Stand gilt, auch mit kleinerer Revision', async () => {
    const server = new FakeServer();
    const anna = device(server, 'anna');
    await anna.open();
    await connected(anna);
    for (let i = 0; i < 4; i++) anna.engine.dispatch('a', { type: 'set', patch: { notes: `v${i}` } });
    await waitFor(() => expect(anna.engine.pending('a')).toBe(0));

    server.epoch = 'epoche-2';
    server.rev = 1;
    server.rows = new Map([['a', { rev: 1, draft: { ...emptyDraft('a'), notes: 'aus dem Backup' }, by: { id: 'x', name: 'X' } }]]);
    server.wake();
    await waitFor(() => expect(anna.view().notes).toBe('aus dem Backup'));
  });

  it('übernimmt Stände anderer Modi, damit „Stoppuhr läuft gerade“ angezeigt werden kann', async () => {
    const server = new FakeServer();
    const anna = device(server, 'anna');
    const tobias = device(server, 'tobias');
    await anna.open('a');
    await tobias.open('a');
    await connected(anna, tobias);
    await anna.engine.load('b');
    anna.engine.dispatch('b', { type: 'start' });
    await waitFor(async () => {
      await tobias.engine.idle();
      expect(((await tobias.db.kv.get('draft.b'))?.value as Draft | undefined)?.isRunning).toBe(true);
    });
  });

  it('ohne Server bleibt alles auf dem Gerät, nichts wird vorgemerkt', async () => {
    const server = new FakeServer();
    const anna = device(server, 'anna');
    anna.dev.account = null;
    await anna.open();
    anna.engine.dispatch('a', { type: 'start' });
    expect(anna.view().isRunning).toBe(true);
    expect(anna.engine.pending('a')).toBe(0);
    await anna.engine.idle();
    expect(((await anna.db.kv.get('draft.a'))?.value as Draft).isRunning).toBe(true);
    expect(server.puts).toBe(0);
  });

  it('älterer Server ohne Live-Stoppuhr (404): weiter wie bisher, nur auf diesem Gerät', async () => {
    const server = new FakeServer();
    const anna = device(server, 'anna');
    anna.dev.status = 404;
    await anna.open();
    await waitFor(() => expect(useLiveStatus.getState().status).toBe('off'));
    anna.engine.dispatch('a', { type: 'start' });
    expect(anna.view().isRunning).toBe(true);
    expect(anna.engine.pending('a')).toBe(0);
  });

  it('nach einem Kontowechsel gehen offene Eingaben des alten Kontos nicht raus', async () => {
    const server = new FakeServer();
    const anna = device(server, 'anna');
    await anna.open();
    await connected(anna);
    anna.setOnline(false);
    anna.engine.dispatch('a', { type: 'start' });
    expect(anna.engine.pending('a')).toBe(1);
    anna.stop();
    await anna.engine.idle();

    anna.dev.account = 'bernd';
    anna.setOnline(true);
    await anna.open();
    await connected(anna);
    await anna.engine.load('a');
    await new Promise((r) => setTimeout(r, 50));
    expect(server.puts).toBe(0);
    expect(anna.engine.pending('a')).toBe(0);
    // Die Stoppuhr selbst bleibt auf dem Gerät (wie beim Abmelden), nur ohne den Abgleich des alten Kontos.
    expect(anna.view().isRunning).toBe(true);

    // Auch nach einem Neustart der App.
    await anna.restart();
    await anna.open();
    await connected(anna);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.puts).toBe(0);
    expect(anna.engine.pending('a')).toBe(0);
  });
});
