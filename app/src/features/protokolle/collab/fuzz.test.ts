import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HubDb } from '@/core/db/db';
import { restoreFromFile } from '../../../../../server/src/backup';
import { headerChange } from '../../../../../server/src/collab/testing';
import { nextRev } from '../../../../../server/src/db';
import { applySync, type SyncRequest as ServerSyncRequest, type SyncUser } from '../../../../../server/src/sync';

/**
 * Mehrere Geräte laufen hier im selben Prozess, die Registrierung der offenen Sitzungen (`session.ts`) kennt aber nur eine Tabelle je Seite.
 * Sie antwortet deshalb für das Gerät, das gerade handelt.
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
import { saveHeader } from '../repo';
import { MIN_SERVER_API } from '../schemaVersion';
import { performSync, type SyncResponse } from '../sync';
import { ANNA, BEN, TestServer, closeDevices, newDevice, textOf, typeInto, wire } from './harness';
import { openProtocol } from './openPlan';
import type { CollabSession } from './session';
import { EPOCH_KEY, type ExchangeTransport } from './wire';
import { loadDoc } from './yStore';

/**
 * Zufallsläufe: drei Geräte (zwei Konten) schreiben, öffnen und schließen Sitzungen, gleichen ab, verlieren die Verbindung oder Antworten,
 * während der Server eine Sicherung zurückbekommt, ersetzt wird oder das Protokoll gelöscht, zurückgezogen und wieder freigegeben wird.
 * Danach kehrt Ruhe ein. Dann muss gelten:
 *
 * - Jedes getippte Zeichen steht irgendwo auf dem Server (im Protokoll oder in einer Kopie „(lokale Fassung)“), außer es gehörte zu einem
 *   Stand, den eine Wiederherstellung bewusst entfernt hat.
 * - Alle Geräte, die das Protokoll noch sehen, zeigen denselben Text wie der Server.
 * - Nichts bleibt als „nicht gesendet“ vorgemerkt.
 *
 * Mit `FUZZ_FROM` und `FUZZ_COUNT` lässt sich ein anderer Bereich von Startwerten prüfen. Ein Fehlschlag nennt Startwert und Ablauf.
 */

const FROM = Number(process.env.FUZZ_FROM ?? 1);
const COUNT = Number(process.env.FUZZ_COUNT ?? 20);
const STEPS = 45;
const ID = 'doc-00001';
/** `FUZZ_TRACE=<Startwert>` schreibt nach jedem Schritt den Zustand aller Geräte in die Datei `FUZZ_LOG` (vitest zeigt Konsolenausgaben hier nicht). */
const TRACE = process.env.FUZZ_TRACE;
const LOG = process.env.FUZZ_LOG ?? join(tmpdir(), 'jfh-fuzz.log');
const log = (line: string): void => appendFileSync(LOG, `${line}\n`);

type Mode = 'restore' | 'wipe' | 'delete';

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
  /** Wahrscheinlichkeit, dass die Antwort des Servers verloren geht (der Server hat die Anfrage aber angewendet). */
  dropRate: number;
  /** Läuft einmal mitten in einer Anfrage, nachdem der Server sie angewendet hat (Tippen, Sichern während des Wartens). */
  hook?: () => Promise<void>;
  session?: CollabSession;
  typed: number;
}

type Json = { content?: { content?: { text?: string }[] }[] };
const textOfJson = (j: Json): string => (j.content ?? []).map((b) => (b.content ?? []).map((t) => t.text ?? '').join('')).join('\n');
const tokensIn = (text: string): string[] => text.match(/<[a-z]\d+>/g) ?? [];

const ACTIONS: Record<Mode, [string, number][]> = {
  restore: [['type', 22], ['open', 6], ['flush', 7], ['round', 8], ['close', 6], ['sync', 11], ['offline', 3], ['lossy', 3], ['typeInFlight', 5], ['persistInFlight', 4], ['backup', 5], ['restore', 7], ['header', 5]],
  wipe: [['type', 22], ['open', 6], ['flush', 7], ['round', 8], ['close', 6], ['sync', 12], ['offline', 3], ['lossy', 3], ['typeInFlight', 5], ['persistInFlight', 4], ['header', 4], ['wipeServer', 5]],
  delete: [['type', 22], ['open', 7], ['flush', 7], ['round', 8], ['close', 6], ['sync', 14], ['offline', 3], ['lossy', 3], ['typeInFlight', 5], ['persistInFlight', 4], ['header', 4], ['ownerDeletes', 4], ['ownerRestores', 4], ['unshare', 3], ['reshare', 3]],
};

async function scenario(seed: number, mode: Mode): Promise<{ problems: string[]; trace: string[] }> {
  const rand = rng(seed);
  const server = new TestServer();
  const problems: string[] = [];
  const trace: string[] = [];
  const typed: string[] = [];
  const excused = new Set<string>();
  let backupFile: string | undefined;
  const dir = mkdtempSync(join(tmpdir(), 'jfh-fuzz-'));
  const make = (name: string, user: SyncUser): Device => ({ name, store: newDevice(name), user, offline: false, dropRate: 0, typed: 0 });
  const devices = [make('a', ANNA), make('b', BEN), make('c', ANNA)];

  server.db.prepare("INSERT INTO users(id, username, displayName, role, passwordHash, createdAt) VALUES('admin-1','admin','Admin','admin','x',1)").run();
  server.put({ id: ID, title: 'Sitzung', ownerId: ANNA.id, shared: true, content: doc(para('Basis')) });

  const serverText = (): string => (server.db.prepare('SELECT content FROM protocols').all() as { content: string }[]).map((r) => textOfJson(JSON.parse(r.content) as Json)).join('\n');

  const textTransport = (d: Device): ExchangeTransport => {
    const inner = server.transport(d.user, async () => (await d.store.kv.get(EPOCH_KEY))?.value as string | undefined);
    return async (req) => {
      if (d.offline) throw new ProtoError('Keine Verbindung zum Server.', 0);
      const res = await inner(req);
      const hook = d.hook;
      d.hook = undefined;
      if (hook) await hook();
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

  /** Abgleich wie `syncNow`: erst die Kopfdaten, danach der Text; die Sitzung dieses Geräts ist die einzige offene. */
  const sync = async (d: Device) => {
    acting.device = d;
    try {
      await performSync(headerSend(d) as never, {}, d.store, server.blobsOf(d.user), textTransport(d));
    } catch {
      /* kein Netz */
    }
  };
  const open = async (d: Device) => {
    if (d.session) return;
    acting.device = d;
    const r = await openProtocol(ID, { store: d.store, transport: textTransport(d), hasServer: async () => true, session: { visible: () => false, intervalMs: 1e9, maxBackoffMs: 1e9 } });
    if (r.kind === 'edit') d.session = r.session;
  };
  const type = async (d: Device) => {
    if (!d.session) return;
    const status = d.session.getInfo().status;
    if (status !== 'ok' && status !== 'rejected') return; // gesperrt oder ersetzt: Die Oberfläche lässt nicht mehr schreiben
    const row = await d.store.protokolle.get(ID);
    if (!row || row.deleted === 1) return;
    const token = `<${d.name}${d.typed++}>`;
    typeInto(d.session.doc, token, rand() < 0.3 ? 0 : undefined);
    typed.push(token);
  };

  try {
    for (const d of devices) await sync(d);
    const table = ACTIONS[mode];
    const total = table.reduce((sum, [, w]) => sum + w, 0);
    for (let i = 0; i < STEPS; i++) {
      const d = devices[Math.floor(rand() * devices.length)]!;
      acting.device = d;
      let pick = rand() * total;
      let act = 'sync';
      for (const [name, weight] of table) {
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
          await s?.destroy();
          break;
        }
        case 'sync':
          await sync(d);
          break;
        case 'offline':
          d.offline = !d.offline;
          break;
        case 'lossy':
          d.dropRate = d.dropRate ? 0 : 0.5;
          break;
        case 'typeInFlight': {
          if (!d.session) break;
          await d.session.flush().catch(() => undefined);
          const running = d.session.exchangeNow().catch(() => undefined);
          await type(d); // getippt, während die Anfrage unterwegs ist
          await running;
          break;
        }
        case 'persistInFlight': {
          const s = d.session;
          if (!s) break;
          await s.flush().catch(() => undefined);
          d.hook = async () => {
            await type(d);
            await s.flush().catch(() => undefined);
          };
          await s.exchangeNow().catch(() => undefined);
          d.hook = undefined;
          break;
        }
        case 'backup':
          backupFile = join(dir, `sicherung-${i}.sqlite`);
          server.db.exec(`VACUUM INTO '${backupFile}'`);
          break;
        case 'restore': {
          if (!backupFile) break;
          const before = new Set(tokensIn(serverText()));
          restoreFromFile(server.db, backupFile);
          const after = new Set(tokensIn(serverText()));
          for (const t of before) if (!after.has(t)) excused.add(t); // das hat die Wiederherstellung bewusst entfernt
          backupFile = undefined;
          break;
        }
        case 'header':
          await saveHeader(d.store, ID, { title: `T-${d.name}-${i}` });
          break;
        case 'wipeServer':
          server.replaceDatabase();
          break;
        case 'ownerDeletes': {
          const now = Date.now();
          server.db.prepare('UPDATE protocols SET deletedAt = ?, rev = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL').run(now, nextRev(server.db), now, ID);
          break;
        }
        case 'ownerRestores':
          server.db.prepare('UPDATE protocols SET deletedAt = NULL, rev = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NOT NULL AND purgedAt IS NULL').run(nextRev(server.db), Date.now(), ID);
          break;
        case 'unshare':
        case 'reshare':
          applySync(server.db, { since: 0, protocols: [headerChange(ID, { shared: act === 'reshare', title: 'Sitzung' })], folders: [], records: [] } as never, ANNA);
          break;
      }
      if (tracing) {
        log(`  Server: ${JSON.stringify(serverText())}`);
        for (const x of devices) {
          const rows = await x.store.ydocs.toArray();
          const parts = await Promise.all(rows.map(async (r) => `${r.id}[dirty=${r.dirty},seq=${r.seq},rej=${r.rejected ? 1 : 0}]=${JSON.stringify(textOf((await loadDoc(r.id, x.store))!.doc))}`));
          const titles = (await x.store.protokolle.toArray()).map((p) => `${p.id}(${p.title},rev=${p.rev},textRev=${p.textRev})`);
          log(`  ${x.name}: offline=${x.offline} Sitzung=${x.session ? `${JSON.stringify(textOf(x.session.doc))}:${x.session.getInfo().status}` : '-'} Zustand: ${parts.join(' | ') || '-'} Zeilen: ${titles.join(' ')}`);
        }
      }
    }

    // Ruhe: alle online, alle Sitzungen beenden (wie im Editor: erst die Sitzung, dann der Abgleich), mehrere Abgleiche.
    for (const d of devices) {
      d.offline = false;
      d.dropRate = 0;
    }
    for (const d of devices) {
      const s = d.session;
      acting.device = d;
      await s?.flush().catch(() => undefined);
      d.session = undefined;
      await s?.destroy();
    }
    for (let round = 0; round < 5; round++) for (const d of devices) await sync(d);

    const everything = serverText();
    for (const t of typed) if (!everything.includes(t) && !excused.has(t)) problems.push(`verloren: ${t}`);

    const row = server.row(ID);
    const mainText = row ? textOfJson(JSON.parse(row.content) as Json) : '';
    const deleted = !!server.db.prepare('SELECT deletedAt FROM protocols WHERE id = ? AND deletedAt IS NOT NULL').get(ID);
    const hiddenFrom = (d: Device): boolean => !!server.db.prepare('SELECT 1 AS x FROM protocols WHERE id = ? AND shared = 0 AND ownerId != ?').get(ID, d.user.id);
    for (const d of devices) {
      if ((await d.store.ydocs.get(ID)) && !deleted && !hiddenFrom(d)) {
        const local = textOf((await loadDoc(ID, d.store))!.doc);
        if (local !== mainText) problems.push(`${d.name}: lokaler Text weicht ab: ${JSON.stringify(local)} <> ${JSON.stringify(mainText)}`);
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

afterEach(async () => {
  acting.device = undefined;
  await closeDevices();
});

describe('Zufallsläufe: mehrere Geräte, Verbindungsabbrüche, Wiederherstellung', () => {
  const modes: [Mode, string][] = [
    ['restore', 'Sicherungen werden zurückgespielt'],
    ['wipe', 'der Server wird durch eine leere Datenbank ersetzt'],
    ['delete', 'das Protokoll wird gelöscht, zurückgeholt, zurückgezogen und wieder freigegeben'],
  ];
  for (const [mode, what] of modes) {
    it(`nichts geht verloren, alle Geräte konvergieren: ${what}`, async () => {
      const bad: Record<number, { problems: string[]; trace: string }> = {};
      for (let seed = FROM; seed < FROM + COUNT; seed++) {
        const { problems, trace } = await scenario(seed, mode);
        if (problems.length) bad[seed] = { problems, trace: trace.join(' ') };
        await closeDevices();
      }
      expect(bad).toEqual({});
    }, 180_000);
  }
});
