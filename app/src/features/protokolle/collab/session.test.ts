import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubDb } from '@/core/db/db';
import type { SyncUser } from '../../../../../server/src/sync';
import { ANNA, BEN, TestServer, closeDevices, newDevice, textOf, typeInto } from './harness';
import { openProtocol } from './openPlan';
import { REMOTE, isSessionOpen, type CollabSession, type SessionOptions } from './session';
import { NoServer, type ExchangeTransport } from './wire';
import { isEmptyUpdate, loadDoc } from './yStore';

const ID = 'doc-00001';
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: object[]) => ({ type: 'doc', content }) as never;

let server: TestServer;
let annaDb: HubDb;
let benDb: HubDb;

beforeEach(async () => {
  server = new TestServer();
  annaDb = newDevice('anna');
  benDb = newDevice('ben');
  server.put({ id: ID, title: 'Sitzung', ownerId: ANNA.id, shared: true, content: doc(para('Basis')) });
  // Beide Geräte kennen das Protokoll und haben seinen Text (der Abgleich lädt ihn vor).
  await server.syncOf(annaDb, ANNA);
  await server.syncOf(benDb, BEN);
});
afterEach(async () => {
  vi.useRealTimers();
  await closeDevices();
});

async function open(store: HubDb, user: SyncUser, over: Partial<SessionOptions> = {}, transport: ExchangeTransport = server.transport(user)): Promise<CollabSession> {
  const r = await openProtocol(ID, { store, transport, hasServer: async () => true, session: over });
  if (r.kind !== 'edit') throw new Error(`nicht zu öffnen: ${r.reason}`);
  return r.session;
}

const stored = (store: HubDb) => store.ydocs.get(ID);
const sync = async (...ss: CollabSession[]) => {
  for (const s of ss) {
    await s.flush();
    await s.exchangeNow();
  }
};

describe('Öffnen', () => {
  it('bindet an den Zustand, den das Gerät schon hat, und schreibt dabei nichts', async () => {
    const before = await stored(annaDb);
    const calls = server.exchanges.length;
    const s = await open(annaDb, ANNA);
    expect(textOf(s.doc)).toBe('Basis');
    await s.exchangeNow(); // ein Abgleich ohne Änderung
    await s.destroy();
    const after = await stored(annaDb);
    expect(after!.seq).toBe(before!.seq);
    expect(after!.dirty).toBe(0);
    const sent = server.exchanges.slice(calls);
    expect(sent.every((r) => r.docs.every((d) => !d.update))).toBe(true); // nichts gesendet
  });
});

describe('zwei Geräte, ein Text', () => {
  it('was einer tippt, sieht der andere nach dem Austausch; der Server hat den Text für Liste und PDF', async () => {
    const anna = await open(annaDb, ANNA);
    const ben = await open(benDb, BEN);
    typeInto(anna.doc, ' und mehr');
    await sync(anna, ben);
    expect(textOf(ben.doc)).toBe('Basis und mehr');
    expect(JSON.parse(server.row(ID)!.content).content[0].content[0].text).toBe('Basis und mehr');
    // Anna ist wieder sauber, Ben hat den Text lokal gesichert
    expect(await stored(annaDb)).toMatchObject({ dirty: 0 });
    expect(textOf((await loadDoc(ID, benDb))!.doc)).toBe('Basis und mehr');
  });

  it('gleichzeitiges Tippen läuft zusammen, ohne Kopie und ohne Verlust', async () => {
    const anna = await open(annaDb, ANNA);
    const ben = await open(benDb, BEN);
    typeInto(anna.doc, ' (Anna)');
    typeInto(ben.doc, ' (Ben)');
    await sync(anna, ben, anna);
    expect(textOf(anna.doc)).toBe(textOf(ben.doc));
    expect(textOf(anna.doc)).toContain('(Anna)');
    expect(textOf(anna.doc)).toContain('(Ben)');
    expect(server.db.prepare("SELECT COUNT(*) AS n FROM protocols WHERE title LIKE '%Konflikt%'").get()).toEqual({ n: 0 });
  });

  it('fremde Änderungen gelten nicht als eigene: sie werden nicht erneut gesendet und nicht als Änderung gespeichert', async () => {
    const anna = await open(annaDb, ANNA);
    const ben = await open(benDb, BEN);
    typeInto(anna.doc, '!');
    await sync(anna, ben);
    const seqBefore = (await stored(benDb))!.seq;
    await ben.flush();
    expect((await stored(benDb))!.seq).toBe(seqBefore); // keine neue eigene Änderung
    expect((await stored(benDb))!.dirty).toBe(0);
  });

  it('weitertippen während des Austauschs geht nicht verloren', async () => {
    const inner = server.transport(ANNA);
    let typed = false;
    let anna: CollabSession | undefined;
    const slow: ExchangeTransport = async (req) => {
      const res = await inner(req);
      if (!typed) {
        typed = true;
        typeInto(anna!.doc, ' zwei'); // der Nutzer tippt weiter, während die Anfrage unterwegs ist
      }
      return res;
    };
    anna = await open(annaDb, ANNA, {}, slow);
    typeInto(anna.doc, ' eins');
    await anna.flush();
    await anna.exchangeNow();
    await anna.flush(); // sichert das Weitergetippte
    expect((await stored(annaDb))!.dirty).toBe(1); // nicht fälschlich als gesendet vermerkt
    await anna.exchangeNow();
    expect(JSON.parse(server.row(ID)!.content).content[0].content[0].text).toBe('Basis eins zwei');
    expect((await stored(annaDb))!.dirty).toBe(0);
  });
});

describe('ohne Netz', () => {
  it('Tippen ohne Verbindung bleibt auf dem Gerät und geht später ohne Konflikt hoch', async () => {
    const ben = await open(benDb, BEN);
    server.offline = true;
    typeInto(ben.doc, ' offline');
    await ben.flush();
    await ben.exchangeNow();
    expect(ben.getInfo().offline).toBe(true);
    expect(ben.getInfo().saved).toBe(true);
    expect(await stored(benDb)).toMatchObject({ dirty: 1 });
    expect(JSON.parse(server.row(ID)!.content).content[0].content[0].text).toBe('Basis');

    // inzwischen schreibt Anna
    server.offline = false;
    const anna = await open(annaDb, ANNA);
    typeInto(anna.doc, ' Anna');
    await sync(anna);
    server.offline = false;
    await sync(ben, anna);
    expect(ben.getInfo().offline).toBe(false);
    expect(textOf(ben.doc)).toBe(textOf(anna.doc));
    expect(textOf(ben.doc)).toContain('offline');
    expect(textOf(ben.doc)).toContain('Anna');
  });

  it('eine verlorene Antwort führt bei der Wiederholung nicht zu doppeltem Text', async () => {
    const ben = await open(benDb, BEN);
    typeInto(ben.doc, ' einmal');
    await ben.flush();
    const real = server.transport(BEN);
    let lost = true;
    const flaky: ExchangeTransport = async (req) => {
      const res = await real(req); // der Server hat gespeichert …
      if (lost) {
        lost = false;
        throw Object.assign(new Error('Antwort verloren'), { status: 0 }); // … die Antwort kommt nicht an
      }
      return res;
    };
    const again = await open(benDb, BEN, {}, flaky);
    await again.exchangeNow();
    await again.exchangeNow();
    expect(JSON.parse(server.row(ID)!.content).content[0].content[0].text).toBe('Basis einmal');
    expect(textOf(again.doc)).toBe('Basis einmal');
  });
});

describe('Sicherung und Schnappschuss', () => {
  it('Änderungen werden auf dem Gerät gesichert, der Schnappschuss für die Liste wird geschrieben', async () => {
    const anna = await open(annaDb, ANNA);
    const rowBefore = await annaDb.protokolle.get(ID);
    typeInto(anna.doc, ' neu');
    expect(anna.getInfo().saved).toBe(false);
    await anna.flush();
    expect(anna.getInfo().saved).toBe(true);
    expect(await stored(annaDb)).toMatchObject({ dirty: 1 });
    const row = await annaDb.protokolle.get(ID);
    expect(JSON.stringify(row!.content)).toContain('Basis neu');
    expect(row!.updatedAt).toBeGreaterThanOrEqual(rowBefore!.updatedAt);
    expect(row!.dirty).toBe(0); // die Kopfdaten sind nicht betroffen
  });

  it('ein Protokoll, das inzwischen gelöscht wurde, bekommt keinen Zustand mehr', async () => {
    const anna = await open(annaDb, ANNA);
    typeInto(anna.doc, ' x');
    await annaDb.protokolle.delete(ID);
    await annaDb.ydocs.delete(ID);
    await anna.destroy();
    expect(await stored(annaDb)).toBeUndefined();
  });

  it('Rückgängig-Schritte und Änderungen des Servers lassen den Zustand wachsen, ohne dass destroy ihn verdichten muss, um korrekt zu bleiben', async () => {
    const anna = await open(annaDb, ANNA);
    for (let i = 0; i < 50; i++) typeInto(anna.doc, 'x');
    await anna.flush();
    await anna.destroy();
    expect(textOf((await loadDoc(ID, annaDb))!.doc)).toBe(`Basis${'x'.repeat(50)}`);
  });
});

describe('Mitschreibende', () => {
  it('der Server nennt, wer das Protokoll noch offen hat (ohne den Aufrufer)', async () => {
    const anna = await open(annaDb, ANNA);
    const ben = await open(benDb, BEN);
    await sync(ben);
    await sync(anna);
    expect(anna.getInfo().peers).toEqual([BEN.id]);
    await sync(ben);
    expect(ben.getInfo().peers).toEqual([ANNA.id]);
  });
});

describe('wenn der Server etwas anderes sagt', () => {
  const stub = (status: string, extra: Record<string, unknown> = {}): ExchangeTransport => async (req) => ({ docs: [{ id: req.docs[0]!.id, status: status as never, ...extra }] });

  it('gelöscht oder zurückgezogen: ungesendete Änderungen bleiben als private Kopie erhalten, der Editor wird schreibgeschützt', async () => {
    const ben = await open(benDb, BEN);
    typeInto(ben.doc, ' wichtige Ergänzung');
    server.db.prepare('UPDATE protocols SET deletedAt = ? WHERE id = ?').run(Date.now(), ID);
    await ben.flush();
    await ben.exchangeNow();
    expect(ben.getInfo().status).toBe('gone');
    const copies = await benDb.protokolle.filter((p) => p.title.endsWith('(lokale Fassung)')).toArray();
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ rev: 0, dirty: 1, shared: false });
    expect(JSON.stringify(copies[0]!.content)).toContain('wichtige Ergänzung');
    expect((await stored(benDb))).toBeUndefined(); // der Zustand des Originals ist verworfen
    expect(await benDb.ydocs.get(copies[0]!.id)).toMatchObject({ dirty: 1 }); // der Text der Kopie ist da und geht beim nächsten Abgleich hoch
  });

  it('gelöscht ohne eigene ungesendete Änderungen: keine Kopie', async () => {
    const ben = await open(benDb, BEN, {}, stub('gone'));
    await ben.exchangeNow();
    expect(ben.getInfo().status).toBe('gone');
    expect(await benDb.protokolle.filter((p) => p.title.endsWith('(lokale Fassung)')).count()).toBe(0);
  });

  it('der Server hat schon Text mit anderer Geschichte (exists): eigene Fassung als Kopie, danach neu öffnen', async () => {
    const onReplaced = vi.fn();
    const ben = await open(benDb, BEN, { onReplaced }, stub('exists'));
    typeInto(ben.doc, ' eigen');
    await ben.flush();
    await ben.exchangeNow();
    expect(ben.getInfo().status).toBe('replaced');
    expect(onReplaced).toHaveBeenCalled();
    expect(await benDb.protokolle.filter((p) => p.title.endsWith('(lokale Fassung)')).count()).toBe(1);
    expect(await stored(benDb)).toBeUndefined();
  });

  it('abgelehnt (zu groß): bleibt auf dem Gerät, wird nicht erneut gesendet, bis weitergeschrieben wird', async () => {
    const calls: unknown[] = [];
    const rejecting: ExchangeTransport = async (req) => {
      calls.push(req.docs[0]!.update);
      return { docs: [{ id: ID, status: 'rejected', reason: 'Protokoll zu groß' }] };
    };
    const ben = await open(benDb, BEN, {}, rejecting);
    typeInto(ben.doc, ' viel');
    await ben.flush();
    await ben.exchangeNow();
    expect(ben.getInfo().status).toBe('rejected');
    expect(ben.getInfo().message).toContain('Protokoll zu groß');
    expect(await stored(benDb)).toMatchObject({ dirty: 1, rejected: 'Protokoll zu groß' });
    await ben.exchangeNow();
    expect(calls.filter(Boolean)).toHaveLength(1); // nicht noch einmal
    typeInto(ben.doc, '!');
    await ben.flush();
    expect((await stored(benDb))!.rejected).toBeUndefined();
  });

  it('der Server hat den Text noch nicht umgestellt (legacy): nur lesen', async () => {
    const ben = await open(benDb, BEN, {}, stub('legacy'));
    await ben.exchangeNow();
    expect(ben.getInfo().status).toBe('legacy');
  });

  it('resync: einmal mit dem ganzen Zustand wiederholen', async () => {
    const reqs: { update?: string }[] = [];
    let first = true;
    const t: ExchangeTransport = async (req) => {
      reqs.push({ update: req.docs[0]!.update });
      if (first) {
        first = false;
        return { docs: [{ id: ID, status: 'resync' }] };
      }
      return server.transport(BEN)(req);
    };
    const ben = await open(benDb, BEN, {}, t);
    typeInto(ben.doc, ' nach');
    await ben.flush();
    await ben.exchangeNow();
    await ben.exchangeNow();
    expect(reqs).toHaveLength(2);
    expect(JSON.parse(server.row(ID)!.content).content[0].content[0].text).toBe('Basis nach');
  });

  it('die Datenbank des Servers wurde ersetzt: nichts wird angewendet, der Abgleich der Protokolle wird angefordert', async () => {
    const requestSync = vi.fn();
    const ben = await open(benDb, BEN, { requestSync }, async () => ({ reset: true, docs: [] }));
    typeInto(ben.doc, ' x');
    await ben.flush();
    await ben.exchangeNow();
    expect(requestSync).toHaveBeenCalled();
    expect(await stored(benDb)).toMatchObject({ dirty: 1 });
  });

  it('Fehlerstatus: 426 und 401 beenden den Austausch, die Änderungen bleiben auf dem Gerät', async () => {
    const { ProtoError } = await import('../http');
    for (const [status, expected] of [[426, 'outdated'], [401, 'auth']] as const) {
      const ben = await open(benDb, BEN, {}, async () => {
        throw new ProtoError('nein', status);
      });
      typeInto(ben.doc, '.');
      await ben.flush();
      await ben.exchangeNow();
      expect(ben.getInfo().status).toBe(expected);
      await ben.destroy();
    }
    expect(await stored(benDb)).toMatchObject({ dirty: 1 });
  });
});

describe('Schutz vor Inhalten, die der Editor nicht kennt', () => {
  it('ein Update mit einem unbekannten Element wird nicht angewendet; die Sitzung sperrt sich', async () => {
    const anna = await open(annaDb, ANNA);
    const ben = await open(benDb, BEN);
    // Ein Client mit anderem Vokabular schreibt ein Element, das diese App nicht kennt.
    const hostile = new Y.Doc();
    Y.applyUpdate(hostile, Y.encodeStateAsUpdate((await loadDoc(ID, annaDb))!.doc));
    hostile.transact(() => hostile.getXmlFragment('body').push([new Y.XmlElement('callout')]));
    anna.doc.destroy();
    server.transport(ANNA)({ docs: [{ id: ID, update: Buffer.from(Y.encodeStateAsUpdate(hostile)).toString('base64'), sv: Buffer.from(Y.encodeStateVector(hostile)).toString('base64') }] });
    await new Promise((r) => setTimeout(r, 0));
    const before = textOf(ben.doc);
    await ben.exchangeNow();
    expect(ben.getInfo().status).toBe('blocked');
    expect(ben.getInfo().message).toContain('callout');
    expect(textOf(ben.doc)).toBe(before);
    expect(ben.doc.getXmlFragment('body').length).toBe(1); // nichts davon im geöffneten Dokument
  });
});

describe('gleichzeitige Strukturänderungen', () => {
  const LIST = 'liste-0001';
  const li = (text: string) => ({ type: 'listItem', content: [para(text)] });

  async function openList(store: HubDb, user: SyncUser): Promise<CollabSession> {
    const r = await openProtocol(LIST, { store, transport: server.transport(user), hasServer: async () => true });
    if (r.kind !== 'edit') throw new Error(`nicht zu öffnen: ${r.reason}`);
    return r.session;
  }
  /** Streicht den Listenpunkt an dieser Stelle der Liste (zweiter Block des Dokuments). */
  const strike = (s: CollabSession, index: number) => (s.doc.getXmlFragment('body').get(1) as Y.XmlElement).delete(index, 1);

  it('streicht jeder einen von zwei Listenpunkten, ist die Liste leer: Sie wird mit einem leeren Punkt ergänzt statt das Protokoll zu sperren', async () => {
    server.put({ id: LIST, title: 'Ablauf', ownerId: ANNA.id, shared: true, content: doc(para('Ablauf'), { type: 'bulletList', content: [li('Aufbau'), li('Abbau')] }) });
    await server.syncOf(annaDb, ANNA);
    await server.syncOf(benDb, BEN);
    const anna = await openList(annaDb, ANNA);
    const ben = await openList(benDb, BEN);
    strike(anna, 0); // Anna streicht „Aufbau“ …
    strike(ben, 1); //  … Ben „Abbau“
    await sync(anna, ben, anna, ben);
    for (const s of [anna, ben]) {
      expect(s.getInfo().status).toBe('ok'); // nicht gesperrt
      expect(s.getInfo().message).toBe('');
      const list = s.doc.getXmlFragment('body').get(1) as Y.XmlElement;
      expect(list.nodeName).toBe('bulletList');
      expect(list.length).toBeGreaterThan(0); // mindestens ein (leerer) Punkt
    }
    expect(textOf(anna.doc)).toBe(textOf(ben.doc));
    const json = JSON.parse(server.row(LIST)!.content) as { content: { type: string; content?: unknown[] }[] };
    expect(json.content[1]!.content!.length).toBeGreaterThan(0); // auch beim Server ist die Liste nicht leer
    await anna.destroy();
    await ben.destroy();
  });

  it('die Ergänzung ist eine eigene Änderung: Sie wird gesichert und gesendet, und die anderen müssen nicht noch einmal reparieren', async () => {
    server.put({ id: LIST, title: 'Ablauf', ownerId: ANNA.id, shared: true, content: doc(para('Ablauf'), { type: 'bulletList', content: [li('Aufbau'), li('Abbau')] }) });
    await server.syncOf(annaDb, ANNA);
    await server.syncOf(benDb, BEN);
    const anna = await openList(annaDb, ANNA);
    const ben = await openList(benDb, BEN);
    strike(anna, 0);
    strike(ben, 1);
    await sync(anna); // Anna schickt ihre Streichung
    await sync(ben); // Ben schickt seine und bekommt Annas: Die Liste wäre leer, er ergänzt sie
    expect(ben.getInfo().status).toBe('ok');
    expect(ben.getInfo().saved).toBe(false); // die Ergänzung ist eine ungesicherte Änderung dieses Geräts …
    await ben.flush();
    expect(await benDb.ydocs.get(LIST)).toMatchObject({ dirty: 1 });
    await sync(ben); // … und geht an den Server
    expect(await benDb.ydocs.get(LIST)).toMatchObject({ dirty: 0 });
    expect(JSON.parse(server.row(LIST)!.content).content[1].content).toHaveLength(1);
    // Anna bekommt Bens Streichung samt Ergänzung und braucht keine eigene
    await sync(anna);
    expect(anna.getInfo().status).toBe('ok');
    expect((anna.doc.getXmlFragment('body').get(1) as Y.XmlElement).length).toBe(1);
    expect(await annaDb.ydocs.get(LIST)).toMatchObject({ dirty: 0 });
    expect(textOf(anna.doc)).toBe(textOf(ben.doc));
    await anna.destroy();
    await ben.destroy();
  });
});

describe('Lebenslauf und Zeitsteuerung', () => {
  it('start meldet den Text als geöffnet (der Hintergrund lässt ihn aus), destroy gibt ihn frei', async () => {
    const s = await open(annaDb, ANNA);
    expect(isSessionOpen(ID)).toBe(false);
    s.start();
    expect(isSessionOpen(ID)).toBe(true);
    await s.destroy();
    expect(isSessionOpen(ID)).toBe(false);
  });

  it('der regelmäßige Austausch läuft von selbst: kurz nach dem Tippen, sonst im Takt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const anna = await open(annaDb, ANNA, { intervalMs: 2500, nudgeMs: 800, persistMs: 100, snapshotMs: 1000 });
    const ben = await open(benDb, BEN, { intervalMs: 2500, nudgeMs: 800, persistMs: 100, snapshotMs: 1000 });
    anna.start();
    ben.start();
    await vi.advanceTimersByTimeAsync(10);
    typeInto(anna.doc, ' live');
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(500);
      expect(textOf(ben.doc)).toBe('Basis live');
    }, { timeout: 20_000, interval: 100 });
    await anna.destroy();
    await ben.destroy();
  });

  it('solange der Editor eine Eingabe verarbeitet (busy), wird nichts angewendet', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let busy = true;
    const anna = await open(annaDb, ANNA);
    const ben = await open(benDb, BEN, { busy: () => busy, intervalMs: 500 });
    typeInto(anna.doc, ' neu');
    await sync(anna);
    ben.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(textOf(ben.doc)).toBe('Basis');
    busy = false;
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(500);
      expect(textOf(ben.doc)).toBe('Basis neu');
    }, { timeout: 20_000, interval: 100 });
    await ben.destroy();
  });

  it('im Hintergrund (Tab verdeckt) wird nicht ausgetauscht, nur gesichert', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let visible = false;
    const calls = server.exchanges.length;
    const ben = await open(benDb, BEN, { visible: () => visible, intervalMs: 500 });
    ben.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(server.exchanges.length).toBe(calls);
    visible = true;
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(500);
      expect(server.exchanges.length).toBeGreaterThan(calls);
    }, { timeout: 20_000, interval: 100 });
    await ben.destroy();
  });

  it('der Austausch verbraucht nichts, wenn nichts zu tun ist (Kurzschluss über die Revision)', async () => {
    const ben = await open(benDb, BEN);
    await ben.exchangeNow();
    const seq = (await stored(benDb))!.seq;
    const reqs = server.exchanges.length;
    await ben.exchangeNow();
    await ben.exchangeNow();
    const sent = server.exchanges.slice(reqs).flatMap((r) => r.docs);
    expect(sent.every((d) => d.rev !== undefined && !d.update)).toBe(true);
    expect((await stored(benDb))!.seq).toBe(seq);
  });

  it('ohne eingerichteten Server (Demo im Browser) ist das kein Ausfall: kein „offline“, und es wird nicht weiter versucht', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let calls = 0;
    const none: ExchangeTransport = async () => {
      calls++;
      throw new NoServer();
    };
    const ben = await open(benDb, BEN, { intervalMs: 500 }, none);
    ben.start();
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(500);
      expect(calls).toBe(1);
    }, { timeout: 20_000, interval: 100 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(1); // nicht noch einmal
    expect(ben.getInfo()).toMatchObject({ offline: false, status: 'ok' });
    typeInto(ben.doc, ' lokal');
    await ben.flush();
    expect(ben.getInfo().saved).toBe(true);
    expect(await stored(benDb)).toMatchObject({ dirty: 1 }); // bleibt auf dem Gerät
    await ben.destroy();
  });

  it('scheitert das Sichern auf dem Gerät (Speicher voll), bleibt der Text im Speicher, es erscheint ein Hinweis, und es wird von selbst noch einmal versucht', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // Der Austausch ist so spät angesetzt, dass er hier nicht stört: Das erneute Sichern muss von der Sitzung selbst kommen.
    const anna = await open(annaDb, ANNA, { persistMs: 100, persistRetryMs: 1000, snapshotMs: 60_000, nudgeMs: 600_000, intervalMs: 600_000 });
    const put = vi.spyOn(annaDb.ydocs, 'put').mockRejectedValueOnce(new DOMException('Der Speicher ist voll', 'QuotaExceededError'));
    typeInto(anna.doc, ' eins');
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(100); // der erste Versuch scheitert
      expect(anna.getInfo().message).toContain('Speichern auf diesem Gerät fehlgeschlagen');
    }, { timeout: 20_000, interval: 20 });
    expect(anna.getInfo().saved).toBe(false);
    expect(textOf((await loadDoc(ID, annaDb))!.doc)).toBe('Basis'); // noch nicht auf dem Gerät
    // niemand tippt weiter: Die Sitzung versucht es trotzdem noch einmal, und diesmal klappt es
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      expect(anna.getInfo()).toMatchObject({ saved: true, message: '' });
    }, { timeout: 20_000, interval: 100 });
    expect(textOf((await loadDoc(ID, annaDb))!.doc)).toBe('Basis eins');
    expect(await stored(annaDb)).toMatchObject({ dirty: 1 });
    put.mockRestore();
    await anna.destroy();
  });

  it('scheitert das Sichern auf dem Gerät, geht der Text trotzdem zum Server (der Austausch nutzt das Dokument im Speicher)', async () => {
    const anna = await open(annaDb, ANNA);
    const put = vi.spyOn(annaDb.ydocs, 'put').mockRejectedValueOnce(new DOMException('Der Speicher ist voll', 'QuotaExceededError'));
    typeInto(anna.doc, ' eins');
    await anna.flush().catch(() => undefined);
    expect(anna.getInfo().saved).toBe(false);
    await anna.exchangeNow();
    expect(JSON.parse(server.row(ID)!.content).content[0].content[0].text).toBe('Basis eins');
    put.mockRestore();
    await anna.flush();
    expect(anna.getInfo()).toMatchObject({ saved: true, message: '' });
    expect(textOf((await loadDoc(ID, annaDb))!.doc)).toBe('Basis eins');
    await anna.destroy();
  });

  it('ein Update, das nur aus Löschungen besteht, ist nicht leer', () => {
    const d = new Y.Doc();
    d.getText('t').insert(0, 'abc');
    const sv = Y.encodeStateVector(d);
    d.getText('t').delete(0, 2);
    expect(isEmptyUpdate(Y.encodeStateAsUpdate(d, sv))).toBe(false);
    expect(REMOTE).toBeTruthy();
  });
});
