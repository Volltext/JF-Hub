import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HubDb, YDocRow } from '@/core/db/db';
import { restoreFromFile } from '../../../../../server/src/backup';
import { applySync, type SyncRequest as ServerSyncRequest, type SyncUser } from '../../../../../server/src/sync';

/**
 * Mehrere Geräte laufen hier im selben Prozess, die Registrierung der offenen Sitzungen (`session.ts`) gilt aber je Seite. Sie antwortet
 * deshalb mit der Sitzung des Geräts, das gerade handelt.
 */
const acting = vi.hoisted(() => ({ device: undefined as undefined | { session?: { id: string } } }));
vi.mock('./session', async () => {
  const actual = await vi.importActual<typeof import('./session')>('./session');
  return {
    ...actual,
    isSessionOpen: (id: string) => acting.device?.session?.id === id,
    getOpenSession: (id: string) => (acting.device?.session?.id === id ? acting.device.session : undefined),
    openSessions: () => (acting.device?.session ? [acting.device.session] : []),
  };
});

import { ProtoError } from '../http';
import { newProtokoll } from '../model';
import { saveHeader } from '../repo';
import { MIN_SERVER_API } from '../schemaVersion';
import { performSync, type SyncResponse } from '../sync';
import { ANNA, BEN, TestServer, closeDevices, newDevice, typeInto, wire } from './harness';
import { openProtocol } from './openPlan';
import type { CollabSession } from './session';
import { refreshSnapshot } from './snapshot';
import { EPOCH_KEY, type ExchangeTransport } from './wire';
import { loadDoc, putLocal } from './yStore';

/**
 * Zufallsläufe zu den Wechseln der Server-Datenbank, ergänzend zu `fuzz.test.ts`: drei Geräte (zwei Konten) mit mehreren Protokollen (eins
 * entsteht auf einem Gerät), Schreiben mit und ohne offene Sitzung, Geräte, die den Text noch nicht vorgeladen haben oder wieder
 * vergessen (sie kennen ihn nur als Schnappschuss), „Alles neu abgleichen“, Kopfdaten, Verbindungsabbrüche und verlorene Antworten.
 * Der Server bekommt eine Sicherung mit derselben Geschichte zurück, eine mit fremder Geschichte (wie aus einer 2.x-Sicherung: der
 * Text entsteht neu aus dem Inhalt) oder wird durch eine neue, leere Datenbank ersetzt. Danach kehrt Ruhe ein. Dann muss gelten:
 *
 * - Jedes getippte Zeichen steht irgendwo auf dem Server (im Protokoll oder in einer Kopie „(lokale Fassung)“), außer es gehörte zu einem
 *   Stand, den eine Wiederherstellung bewusst entfernt hat.
 * - Kein Zeichen steht im selben Protokoll doppelt (so zeigt sich, wenn zwei unabhängige Basen zusammengeführt wurden).
 * - Alle Geräte, die ein Protokoll noch sehen, haben denselben Text wie der Server; nichts bleibt als „nicht gesendet“ vorgemerkt.
 *
 * `FUZZ_FROM`, `FUZZ_COUNT` und `FUZZ_STEPS` wählen Startwerte und Länge, `FUZZ_SEEDS=3,7` bestimmte Läufe. Ein Fehlschlag nennt Startwert und
 * Ablauf; `FUZZ_TRACE=<Startwert>` schreibt nach jedem Schritt den Zustand aller Geräte in die Datei `FUZZ_LOG`.
 */
const FROM = Number(process.env.FUZZ_FROM ?? 1);
const COUNT = Number(process.env.FUZZ_COUNT ?? 30);
const STEPS = Number(process.env.FUZZ_STEPS ?? 60);
const LOG = process.env.FUZZ_LOG ?? join(tmpdir(), 'jfh-fuzz-epochs.log');
const TRACE = process.env.FUZZ_TRACE;
const log = (line: string): void => appendFileSync(LOG, `${line}\n`);
const P1 = 'doc-00001';
const P3 = 'doc-00003';

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: object[]) => ({ type: 'doc', content }) as never;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Device {
  name: string;
  store: HubDb;
  user: SyncUser;
  offline: boolean;
  dropRate: number;
  session?: CollabSession;
  sessionId?: string;
  typed: number;
}

type Json = { content?: { content?: { text?: string }[] }[] };
const textOfJson = (j: Json): string => (j.content ?? []).map((b) => (b.content ?? []).map((t) => t.text ?? '').join('')).join('\n');
const tokensIn = (text: string): string[] => text.match(/<[a-z]\d+>/g) ?? [];

const ACTIONS: [string, number][] = [
  ['type', 22], ['typeClosed', 8], ['open', 6], ['flush', 5], ['round', 7], ['close', 6], ['sync', 12], ['syncFull', 5], ['offline', 3], ['lossy', 3],
  ['header', 4], ['create', 3], ['dropState', 3], ['backup', 4], ['restoreShared', 4], ['restoreIndep', 4], ['wipeEmpty', 4],
];

async function scenario(seed: number): Promise<{ problems: string[]; trace: string[] }> {
  const rand = rng(seed);
  const server = new TestServer();
  const problems: string[] = [];
  const trace: string[] = [];
  const typed: string[] = [];
  const excused = new Set<string>();
  let backupFile: string | undefined;
  let backupContent: Record<string, { title: string; owner: string; shared: boolean; content: unknown }> = {};
  const dir = mkdtempSync(join(tmpdir(), 'jfh-fuzz-epochs-'));
  const make = (name: string, user: SyncUser): Device => ({ name, store: newDevice(name), user, offline: false, dropRate: 0, typed: 0 });
  const devices = [make('a', ANNA), make('b', BEN), make('c', ANNA)];

  server.db.prepare("INSERT INTO users(id, username, displayName, role, passwordHash, createdAt) VALUES('admin-1','admin','Admin','admin','x',1)").run();
  server.put({ id: P1, title: 'Sitzung', ownerId: ANNA.id, shared: true, content: doc(para('Basis')) });

  const rows = () => server.db.prepare('SELECT id, title, content, ownerId, shared FROM protocols').all() as { id: string; title: string; content: string; ownerId: string; shared: number }[];
  const serverText = (): string => rows().map((r) => textOfJson(JSON.parse(r.content) as Json)).join('\n');

  const textTransport = (d: Device): ExchangeTransport => {
    const inner = server.transport(d.user, async () => (await d.store.kv.get(EPOCH_KEY))?.value as string | undefined);
    return async (req) => {
      if (d.offline) throw new ProtoError('Keine Verbindung zum Server.', 0);
      const res = await inner(req);
      if (d.dropRate && rand() < d.dropRate) throw new ProtoError('Keine Verbindung zum Server.', 0);
      return res;
    };
  };
  const headerSend = (d: Device) => async (req: unknown): Promise<SyncResponse> => {
    if (d.offline) throw new ProtoError('Keine Verbindung zum Server.', 0);
    const res = applySync(server.db, wire(req) as unknown as ServerSyncRequest, d.user);
    if (d.dropRate && rand() < d.dropRate) throw new ProtoError('Keine Verbindung zum Server.', 0);
    return { ...wire(res), api: MIN_SERVER_API } as unknown as SyncResponse;
  };
  const sync = async (d: Device, full = false) => {
    acting.device = d;
    try {
      await performSync(headerSend(d) as never, { full }, d.store, server.blobsOf(d.user), textTransport(d));
    } catch {
      /* kein Netz */
    }
  };
  const protocolsOf = async (d: Device): Promise<string[]> => (await d.store.protokolle.filter((p) => p.deleted === 0).toArray()).map((p) => p.id);
  const open = async (d: Device) => {
    if (d.session) return;
    const ids = await protocolsOf(d);
    if (!ids.length) return;
    const id = ids[Math.floor(rand() * ids.length)]!;
    acting.device = d;
    const r = await openProtocol(id, { store: d.store, transport: textTransport(d), hasServer: async () => true, session: { visible: () => false, intervalMs: 1e9, maxBackoffMs: 1e9 } });
    if (r.kind === 'edit') {
      d.session = r.session;
      d.sessionId = id;
    }
  };
  /**
   * Tokens, die ein Gerät noch nicht abgegeben hat: ungesendeter Zustand, und der noch nicht gesicherte Text einer offenen Sitzung. Was ein
   * Server früher bestätigt hat, den es nicht mehr gibt, zählt nicht: Eine Wiederherstellung darf es entfernen.
   */
  const unsentTokens = async (): Promise<Set<string>> => {
    const out = new Set<string>();
    const onServer = new Set(tokensIn(serverText()));
    for (const d of devices) {
      for (const st of await d.store.ydocs.where('dirty').equals(1).toArray()) {
        const l = await loadDoc(st.id, d.store);
        if (l) for (const t of tokensIn(textOfJsonDoc(l.doc))) out.add(t);
      }
      if (d.session && !d.session.getInfo().saved) for (const t of tokensIn(textOfJsonDoc(d.session.doc))) if (!onServer.has(t)) out.add(t);
    }
    return out;
  };
  const excuseCleanTokens = async () => {
    const unsent = await unsentTokens();
    for (const t of typed) if (!unsent.has(t)) excused.add(t);
  };
  const token = (d: Device) => `<${d.name}${d.typed++}>`;
  const type = async (d: Device) => {
    if (!d.session) return;
    const status = d.session.getInfo().status;
    if (status !== 'ok' && status !== 'rejected') return;
    const row = await d.store.protokolle.get(d.sessionId!);
    if (!row || row.deleted === 1) return;
    const t = token(d);
    typeInto(d.session.doc, t, rand() < 0.3 ? 0 : undefined);
    typed.push(t);
  };
  /** Schreiben ohne offene Sitzung (der Editor war geschlossen, der Text liegt nur auf dem Gerät). */
  const typeClosed = async (d: Device) => {
    const ids = (await protocolsOf(d)).filter((id) => id !== d.sessionId);
    if (!ids.length) return;
    const id = ids[Math.floor(rand() * ids.length)]!;
    const loaded = await loadDoc(id, d.store);
    if (!loaded) return;
    const row = await d.store.protokolle.get(id);
    if (!row || row.legacy) return;
    const before = Y.encodeStateVector(loaded.doc);
    const t = token(d);
    typeInto(loaded.doc, t, rand() < 0.3 ? 0 : undefined);
    await putLocal(id, Y.encodeStateAsUpdate(loaded.doc, before), d.store);
    await refreshSnapshot(id, Y.encodeStateAsUpdate(loaded.doc), d.store);
    typed.push(t);
  };

  try {
    for (const d of devices) await sync(d);
    const total = ACTIONS.reduce((sum, [, w]) => sum + w, 0);
    for (let i = 0; i < STEPS; i++) {
      const d = devices[Math.floor(rand() * devices.length)]!;
      acting.device = d;
      let pick = rand() * total;
      let act = 'sync';
      for (const [name, weight] of ACTIONS) {
        if (pick < weight) {
          act = name;
          break;
        }
        pick -= weight;
      }
      trace.push(`${d.name}:${act}`);
      const tracing = TRACE === String(seed);
      if (tracing) log(`--- Schritt ${i}: ${d.name}:${act}`);
      switch (act) {
        case 'type':
          await type(d);
          break;
        case 'typeClosed':
          await typeClosed(d);
          break;
        case 'open':
          await open(d);
          break;
        case 'flush':
          await d.session?.flush().catch(() => undefined);
          break;
        case 'round':
          await d.session?.exchangeNow().catch(() => undefined);
          break;
        case 'close': {
          const s = d.session;
          d.session = undefined;
          d.sessionId = undefined;
          await s?.destroy();
          break;
        }
        case 'sync':
          await sync(d);
          break;
        case 'syncFull':
          await sync(d, true);
          break;
        case 'offline':
          d.offline = !d.offline;
          break;
        case 'lossy':
          d.dropRate = d.dropRate ? 0 : 0.5;
          break;
        case 'header':
          await saveHeader(d.store, P1, { title: `T-${d.name}-${i}` }).catch(() => undefined);
          break;
        case 'create': {
          if (await d.store.protokolle.get(P3)) break;
          if (rows().some((r) => r.id === P3)) break;
          const p = { ...newProtokoll('', true), id: P3, title: 'Drei', rev: 0, dirty: 1 as const, ownerId: undefined };
          await d.store.protokolle.add(p);
          const dd = new Y.Doc();
          const t = token(d);
          typeInto(dd, t);
          await putLocal(P3, Y.encodeStateAsUpdate(dd), d.store);
          await refreshSnapshot(P3, Y.encodeStateAsUpdate(dd), d.store);
          typed.push(t);
          break;
        }
        case 'dropState': {
          // Ein Gerät, das den Text noch nicht vorgeladen hat und ihn nur als Schnappschuss in der Liste kennt. Hat es selbst hineingetippt,
          // kann es ihn nicht „noch nicht haben“: Seine Zeile verschwindet nie.
          const own = new RegExp(`<${d.name}\\d+>`);
          const mine: YDocRow[] = [];
          for (const st of await d.store.ydocs.filter((r) => r.dirty === 0 && r.id !== d.sessionId).toArray()) {
            const l = await loadDoc(st.id, d.store);
            if (l && !own.test(textOfJsonDoc(l.doc))) mine.push(st);
          }
          if (!mine.length) break;
          const r = mine[Math.floor(rand() * mine.length)]!;
          await d.store.ydocs.delete(r.id);
          await d.store.protokolle.update(r.id, { textRev: undefined });
          break;
        }
        case 'backup':
          backupFile = join(dir, `sicherung-${i}.sqlite`);
          server.db.exec(`VACUUM INTO '${backupFile}'`);
          backupContent = Object.fromEntries(rows().map((r) => [r.id, { title: r.title, owner: r.ownerId, shared: r.shared === 1, content: JSON.parse(r.content) }]));
          break;
        case 'restoreShared': {
          if (!backupFile) break;
          await excuseCleanTokens();
          restoreFromFile(server.db, backupFile);
          backupFile = undefined;
          break;
        }
        case 'restoreIndep': {
          // wie eine Sicherung aus 2.x: neuer Server, der Text hat eine fremde Geschichte (jsonToYDoc beim Umstellen)
          await excuseCleanTokens();
          const snapshot = Object.keys(backupContent).length ? backupContent : Object.fromEntries(rows().map((r) => [r.id, { title: r.title, owner: r.ownerId, shared: r.shared === 1, content: JSON.parse(r.content) }]));
          server.replaceDatabase({ restored: true });
          server.db.prepare("INSERT INTO users(id, username, displayName, role, passwordHash, createdAt) VALUES('admin-1','admin','Admin','admin','x',1)").run();
          for (const [id, p] of Object.entries(snapshot)) server.put({ id, title: p.title, ownerId: p.owner, shared: p.shared, content: p.content as never });
          backupFile = undefined;
          break;
        }
        case 'wipeEmpty':
          server.replaceDatabase();
          server.db.prepare("INSERT INTO users(id, username, displayName, role, passwordHash, createdAt) VALUES('admin-1','admin','Admin','admin','x',1)").run();
          backupFile = undefined;
          break;
      }
      if (tracing) {
        log(`  Server: ${JSON.stringify(rows().map((r) => [r.id, textOfJson(JSON.parse(r.content) as Json)]))}`);
        for (const x of devices) {
          const states = await x.store.ydocs.toArray();
          const parts = await Promise.all(
            states.map(async (r) => {
              const l = await loadDoc(r.id, x.store);
              return `${r.id}[dirty=${r.dirty},seq=${r.seq},created=${r.created ? 1 : 0},rej=${r.rejected ? 1 : 0}]=${JSON.stringify(l ? textOfJsonDoc(l.doc) : '?')}`;
            }),
          );
          const titles = (await x.store.protokolle.toArray()).map((p) => `${p.id}(${p.title},rev=${p.rev},textRev=${p.textRev},d=${p.dirty})`);
          log(`  ${x.name}: offline=${x.offline} Sitzung=${x.session ? `${x.sessionId}:${JSON.stringify(textOfJsonDoc(x.session.doc))}:${x.session.getInfo().status}` : '-'} Zustand: ${parts.join(' | ') || '-'} Zeilen: ${titles.join(' ')}`);
        }
      }
    }

    for (const d of devices) {
      d.offline = false;
      d.dropRate = 0;
    }
    for (const d of devices) {
      const s = d.session;
      acting.device = d;
      await s?.flush().catch(() => undefined);
      d.session = undefined;
      d.sessionId = undefined;
      await s?.destroy();
    }
    const dump = async (label: string) => {
      if (TRACE !== String(seed)) return;
      log(`--- ${label}`);
      log(`  Server: ${JSON.stringify(rows().map((r) => [r.id, r.title, textOfJson(JSON.parse(r.content) as Json)]))}`);
      for (const x of devices) {
        const states = await x.store.ydocs.toArray();
        const parts = await Promise.all(
          states.map(async (r) => {
            const l = await loadDoc(r.id, x.store);
            return `${r.id}[dirty=${r.dirty},seq=${r.seq},created=${r.created ? 1 : 0}]=${JSON.stringify(l ? textOfJsonDoc(l.doc) : '?')}`;
          }),
        );
        const titles = (await x.store.protokolle.toArray()).map((q) => `${q.id}(${q.title},rev=${q.rev},d=${q.dirty})`);
        log(`  ${x.name}: Zustand: ${parts.join(' | ') || '-'} Zeilen: ${titles.join(' ')}`);
      }
    };
    await dump('Ruhe: Beginn');
    for (let round = 0; round < 6; round++)
      for (const d of devices) {
        await sync(d);
        await dump(`Ruhe: Runde ${round} ${d.name}`);
      }
    for (const d of devices) {
      await sync(d, true);
      await dump(`Ruhe: voll ${d.name}`);
    }
    for (const d of devices) await sync(d);

    const everything = serverText();
    for (const t of typed) if (!everything.includes(t) && !excused.has(t)) problems.push(`verloren: ${t}`);
    for (const r of rows()) {
      const text = textOfJson(JSON.parse(r.content) as Json);
      const seen = new Map<string, number>();
      for (const t of tokensIn(text)) seen.set(t, (seen.get(t) ?? 0) + 1);
      for (const [t, n] of seen) if (n > 1) problems.push(`doppelt (${n}x) in ${r.title || r.id}: ${t}`);
    }
    for (const d of devices) {
      for (const st of await d.store.ydocs.toArray()) {
        const r = rows().find((x) => x.id === st.id);
        if (!r) continue;
        const visible = r.shared === 1 || r.ownerId === d.user.id;
        if (!visible) continue;
        const local = textOfJsonDoc((await loadDoc(st.id, d.store))!.doc);
        const mainText = textOfJson(JSON.parse(r.content) as Json);
        if (local !== mainText) problems.push(`${d.name}: lokaler Text von ${st.id} weicht ab: ${JSON.stringify(local)} <> ${JSON.stringify(mainText)}`);
      }
      const unsentTexts = await d.store.ydocs.where('dirty').equals(1).count();
      const unsentHeaders = await d.store.protokolle.where('dirty').equals(1).count();
      if (unsentTexts || unsentHeaders) problems.push(`${d.name}: noch vorgemerkt: Texte ${unsentTexts}, Kopfdaten ${unsentHeaders}`);
    }
  } finally {
    acting.device = undefined;
    rmSync(dir, { recursive: true, force: true });
  }
  return { problems, trace };
}

import { yDocToJson } from './yJson';
const textOfJsonDoc = (d: Y.Doc): string => textOfJson(yDocToJson(d) as Json);

afterEach(async () => {
  acting.device = undefined;
  await closeDevices();
});

describe('Zufallsläufe: Wechsel der Server-Datenbank, mehrere Protokolle, Geräte mit unvollständigem Zustand', () => {
  it('nichts geht verloren, nichts steht doppelt, alle Geräte konvergieren', async () => {
    const bad: Record<number, { problems: string[]; trace: string }> = {};
    const seeds = process.env.FUZZ_SEEDS ? process.env.FUZZ_SEEDS.split(',').map(Number) : Array.from({ length: COUNT }, (_, i) => FROM + i);
    for (const seed of seeds) {
      const { problems, trace } = await scenario(seed);
      if (problems.length) bad[seed] = { problems, trace: trace.join(' ') };
      await closeDevices();
    }
    expect(bad).toEqual({});
  }, 900_000);
});
