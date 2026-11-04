import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getEpoch, openDb } from '../db.js';
import type { SyncUser } from '../sync.js';
import { FIELD, jsonToYDoc, type DocNode } from './convert.js';
import { exchange, LIMITS, type ExchangeDoc, type ExchangeResult, type Limits } from './exchange.js';
import { createPeers, type Peers } from './peers.js';
import { putProtocol, textOf } from './testing.js';

const ANNA: SyncUser = { id: 'u-anna', role: 'betreuer' };
const BEN: SyncUser = { id: 'u-ben', role: 'betreuer' };

const p = (...content: DocNode[]): DocNode => ({ type: 'paragraph', content });
const t = (text: string): DocNode => ({ type: 'text', text });
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const isEmpty = (u: Uint8Array) => u.length === 2 && u[0] === 0 && u[1] === 0;

let db: DatabaseSync;
let peers: Peers;
beforeEach(() => {
  db = openDb(':memory:');
  peers = createPeers();
});

/** Ein Gerät: lokales Y-Dokument und das, was es vom Server weiß. */
class Device {
  doc: Y.Doc;
  /** Zuletzt bestätigter Zustandsvektor des Servers. */
  serverSv: Uint8Array | undefined;
  rev: number | undefined;
  constructor(
    readonly user: SyncUser,
    readonly id: string,
    content?: DocNode,
  ) {
    this.doc = content ? jsonToYDoc(content) : new Y.Doc();
  }
  get text(): string {
    return textOf(this.doc);
  }
  /** Das Y.XmlText im ersten Absatz. */
  get first(): Y.XmlText {
    return (this.doc.getXmlFragment(FIELD).get(0) as Y.XmlElement).get(0) as Y.XmlText;
  }
  request(extra: Partial<ExchangeDoc> = {}): ExchangeDoc {
    const update = Y.encodeStateAsUpdate(this.doc, this.serverSv);
    return { id: this.id, sv: b64(Y.encodeStateVector(this.doc)), ...(isEmpty(update) ? {} : { update: b64(update) }), ...(this.rev === undefined ? {} : { rev: this.rev }), ...extra };
  }
  run(extra: Partial<ExchangeDoc> = {}, now = Date.now(), limits: Limits = LIMITS): ExchangeResult {
    const res = exchange(db, { epoch: getEpoch(db), docs: [this.request(extra)] }, this.user, peers, now, limits);
    const r = res.docs[0]!;
    this.take(r);
    return r;
  }
  take(r: ExchangeResult): void {
    if (r.status !== 'ok') return;
    if (r.update) Y.applyUpdate(this.doc, unb64(r.update));
    if (r.sv) this.serverSv = unb64(r.sv);
    this.rev = r.rev;
  }
}

const row = (id: string) => db.prepare('SELECT content, rev, updatedAt FROM protocols WHERE id = ?').get(id) as { content: string; rev: number; updatedAt: number };
const stored = (id: string) => db.prepare('SELECT state, sv, updatedAt FROM ydocs WHERE id = ?').get(id) as { state: Uint8Array; sv: Uint8Array; updatedAt: number } | undefined;

describe('Austausch: Anlegen und Abholen', () => {
  it('das erste Senden legt Zustand und abgeleiteten Inhalt an', () => {
    const id = putProtocol(db, { ownerId: ANNA.id, shared: false });
    const before = row(id);
    const anna = new Device(ANNA, id, doc(p(t('Hallo Welt'))));
    const r = anna.run({ create: true }, 5_000);
    expect(r.status).toBe('ok');
    expect(r.rev).toBeGreaterThan(before.rev);
    const after = row(id);
    expect(after.rev).toBe(r.rev);
    expect(after.updatedAt).toBe(5_000);
    expect(JSON.parse(after.content)).toEqual(doc(p(t('Hallo Welt'))));
    const s = stored(id)!;
    expect(s.updatedAt).toBe(5_000);
    expect(b64(s.sv)).toBe(r.sv);
    // der Server hat genau das, was der Client hat: nichts mehr zu holen
    expect(r.update).toBeUndefined();
  });

  it('ein zweites Gerät holt den Text', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    new Device(ANNA, id, doc(p(t('Hallo Welt')))).run({ create: true });
    const ben = new Device(BEN, id);
    const r = ben.run();
    expect(r.update).toBeDefined();
    expect(ben.text).toBe('Hallo Welt');
  });

  it('ohne Text beim Server und ohne Update kommt ein leerer Zustand zurück', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    const r = new Device(ANNA, id).run();
    expect(r).toMatchObject({ status: 'ok' });
    expect(r.update).toBeUndefined();
    expect(stored(id)).toBeUndefined();
  });

  it('eine Basis aus altem Inhalt, die der Server schon kennt, wird abgelehnt, wenn die Geschichte eine andere ist', () => {
    const id = putProtocol(db, { ownerId: ANNA.id, content: doc(p(t('Altbestand'))) });
    const stateBefore = stored(id)!.state;
    const ben = new Device(BEN, id, doc(p(t('Altbestand')))); // baut dieselbe Basis selbst
    const r = ben.run({ create: true });
    expect(r.status).toBe('exists');
    expect(stored(id)!.state).toEqual(stateBefore);
  });

  it('ein leerer Zustand beim Server ist kein Text: die Basis wird angenommen', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    const empty = new Y.Doc();
    db.prepare('INSERT INTO ydocs(id, state, sv, updatedAt) VALUES(?,?,?,?)').run(id, Y.encodeStateAsUpdate(empty), Y.encodeStateVector(empty), 1);
    const r = new Device(ANNA, id, doc(p(t('Altbestand')))).run({ create: true });
    expect(r.status).toBe('ok');
    expect(JSON.parse(row(id).content)).toEqual(doc(p(t('Altbestand'))));
  });

  it('eine Wiederholung nach verlorener Antwort ist keine fremde Basis', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    const anna = new Device(ANNA, id, doc(p(t('Hallo'))));
    // Antwort geht verloren: Anna wendet sie nicht an
    exchange(db, { epoch: getEpoch(db), docs: [anna.request({ create: true })] }, ANNA, peers);
    const ben = new Device(BEN, id);
    ben.run();
    ben.first.insert(5, ' Ben');
    ben.run();
    // Anna fragt erneut mit create und demselben Stand: Der Server kennt ihre Geschichte
    const again = anna.run({ create: true });
    expect(again.status).toBe('ok');
    expect(anna.text).toBe('Hallo Ben');
  });
});

describe('Austausch: Zusammenführen', () => {
  it('gleichzeitige Änderungen laufen zusammen, und beide Geräte ergeben denselben Text', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    const anna = new Device(ANNA, id, doc(p(t('Basis'))));
    anna.run({ create: true });
    const ben = new Device(BEN, id);
    ben.run();
    anna.first.insert(5, ' von Anna');
    ben.first.insert(0, 'Ben: ');
    anna.run();
    ben.run();
    anna.run();
    expect(anna.text).toBe(ben.text);
    expect(anna.text).toContain('von Anna');
    expect(anna.text).toContain('Ben: ');
    expect(JSON.parse(row(id).content)).toEqual(JSON.parse(JSON.stringify(Object.assign({}, { type: 'doc', content: [p(t(anna.text))] }))));
  });

  it('wiederholtes Senden ändert nichts mehr (Revision und Zeit bleiben)', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    const anna = new Device(ANNA, id, doc(p(t('Hallo'))));
    anna.run({ create: true }, 1_000);
    const first = row(id);
    anna.serverSv = undefined; // als hätte sie die Bestätigung nie bekommen
    anna.run({}, 9_000);
    anna.serverSv = undefined;
    anna.run({}, 9_500);
    expect(row(id)).toEqual(first);
    expect(stored(id)!.updatedAt).toBe(1_000);
  });

  it('eine reine Löschung wird gespeichert (sie ändert den Zustandsvektor nicht)', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    const anna = new Device(ANNA, id, doc(p(t('Hallo Welt'))));
    anna.run({ create: true });
    const rev = row(id).rev;
    anna.first.delete(5, 5); // " Welt"
    const r = anna.run();
    expect(r.rev).toBeGreaterThan(rev);
    expect(JSON.parse(row(id).content)).toEqual(doc(p(t('Hallo'))));
    // ein zweites Gerät bekommt die Löschung, obwohl sein Zustandsvektor dem des Servers gleicht
    const ben = new Device(BEN, id);
    ben.run();
    expect(ben.text).toBe('Hallo');
  });

  it('ein Gerät mit altem Stand holt nur die Differenz', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    const anna = new Device(ANNA, id, doc(p(t('Eins'))));
    anna.run({ create: true });
    const ben = new Device(BEN, id);
    ben.run();
    anna.first.insert(4, ' zwei');
    anna.run();
    const r = ben.run();
    expect(ben.text).toBe('Eins zwei');
    expect(Buffer.from(r.update!, 'base64').length).toBeLessThan(Y.encodeStateAsUpdate(anna.doc).length);
  });

  it('ist die Revision seit der letzten Antwort gleich geblieben, entfällt die Rechnung', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    const anna = new Device(ANNA, id, doc(p(t('Hallo'))));
    anna.run({ create: true });
    const idle = anna.run();
    expect(idle).toEqual({ id, status: 'ok', rev: anna.rev });
    const ben = new Device(BEN, id);
    ben.run();
    ben.first.insert(5, '!');
    ben.run();
    const busy = anna.run();
    expect(busy.update).toBeDefined();
    expect(anna.text).toBe('Hallo!');
  });
});

describe('Austausch: Zugriff', () => {
  it('fremde private, gelöschte, geleerte und unbekannte Protokolle gibt es nicht', () => {
    const privat = putProtocol(db, { ownerId: ANNA.id, shared: false, content: doc(p(t('geheim'))) });
    const geloescht = putProtocol(db, { ownerId: ANNA.id, deleted: true, content: doc(p(t('weg'))) });
    const geleert = putProtocol(db, { ownerId: ANNA.id, purged: true });
    for (const id of [privat, geloescht, geleert, 'gibt-es-nicht']) {
      const r = new Device(BEN, id).run();
      expect(r, id).toEqual({ id, status: 'gone' });
    }
    // der Besitzer sieht sein privates, aber nicht das gelöschte
    expect(new Device(ANNA, privat).run().status).toBe('ok');
    expect(new Device(ANNA, geloescht).run().status).toBe('gone');
  });

  it('ein Protokoll, das noch nicht umgestellt ist, ist nur zum Lesen da', () => {
    const id = putProtocol(db, { ownerId: ANNA.id, ymode: 0, content: doc(p(t('alt'))) });
    expect(new Device(ANNA, id, doc(p(t('neu')))).run()).toEqual({ id, status: 'legacy' });
    expect(stored(id)).toBeUndefined();
  });

  it('eine falsche Epoche wendet nichts an', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    const anna = new Device(ANNA, id, doc(p(t('Hallo'))));
    const res = exchange(db, { epoch: 'andere-datenbank', docs: [anna.request({ create: true })] }, ANNA, peers);
    expect(res).toMatchObject({ reset: true, epoch: getEpoch(db), docs: [] });
    expect(stored(id)).toBeUndefined();
    // ohne Epoche (noch nie abgeglichen) wird angewendet
    const ok = exchange(db, { docs: [anna.request({ create: true })] }, ANNA, peers);
    expect(ok.docs[0]!.status).toBe('ok');
  });
});

describe('Austausch: Grenzen und feindliche Eingaben', () => {
  it('lehnt ungültige Anfragen ab', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    const bad: ExchangeDoc[] = [
      { id: '!' },
      { id, sv: '***' },
      { id, sv: 'BQE=' }, // behauptet fünf Einträge, bricht aber ab
      { id, update: '***' },
      { id, update: 'AQIDBAUG' }, // kein Update
    ];
    for (const d of bad) {
      const r = exchange(db, { docs: [d] }, ANNA, peers).docs[0]!;
      expect(r.status, JSON.stringify(d)).toBe('rejected');
    }
    expect(stored(id)).toBeUndefined();
  });

  it('lehnt zu große Updates und Zustände ab', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    const anna = new Device(ANNA, id, doc(p(t('x'.repeat(2000)))));
    expect(anna.run({ create: true }, 1, { ...LIMITS, maxUpdate: 500 })).toMatchObject({ status: 'rejected', reason: 'Änderung zu groß' });
    expect(anna.run({ create: true }, 1, { ...LIMITS, maxState: 500 })).toMatchObject({ status: 'rejected', reason: 'Protokoll zu groß' });
    expect(stored(id)).toBeUndefined();
    expect(anna.run({ create: true }).status).toBe('ok');
  });

  it('ein Update, das auf Unbekanntem aufbaut, wird zurückgehalten (resync) und ändert nichts', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    const base = jsonToYDoc(doc(p(t('Basis'))));
    const sv = Y.encodeStateVector(base);
    ((base.getXmlFragment(FIELD).get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(5, '!');
    const increment = Y.encodeStateAsUpdate(base, sv); // setzt die Basis voraus, die der Server nicht hat
    const r = exchange(db, { docs: [{ id, update: b64(increment) }] }, ANNA, peers).docs[0]!;
    expect(r).toEqual({ id, status: 'resync' });
    expect(stored(id)).toBeUndefined();
  });

  it('ein Dokument mit Text auf der obersten Ebene oder Binärattribut wird abgelehnt und nicht gespeichert', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    const lose = new Y.Doc();
    const text = new Y.XmlText();
    lose.getXmlFragment(FIELD).insert(0, [text]);
    text.insert(0, 'lose');
    const r = exchange(db, { docs: [{ id, update: b64(Y.encodeStateAsUpdate(lose)) }] }, ANNA, peers).docs[0]!;
    expect(r).toMatchObject({ status: 'rejected', reason: 'Text außerhalb eines Absatzes' });

    const binary = new Y.Doc();
    const el = new Y.XmlElement('ink');
    binary.getXmlFragment(FIELD).insert(0, [el]);
    el.setAttribute('ink', new Uint8Array([1, 2]) as never);
    const r2 = exchange(db, { docs: [{ id, update: b64(Y.encodeStateAsUpdate(binary)) }] }, ANNA, peers).docs[0]!;
    expect(r2.status).toBe('rejected');
    expect(stored(id)).toBeUndefined();
    expect(JSON.parse(row(id).content)).toEqual({ type: 'doc', content: [] });
  });

  it('begrenzt die Zahl der Dokumente je Anfrage und die Größe der Antwort', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `unbekannt-${String(i).padStart(2, '0')}`);
    const res = exchange(db, { docs: ids.map((id) => ({ id })) }, ANNA, peers).docs;
    expect(res.slice(0, 20).every((r) => r.status === 'gone')).toBe(true);
    expect(res.slice(20).every((r) => r.status === 'deferred')).toBe(true);

    const a = putProtocol(db, { ownerId: ANNA.id, content: doc(p(t('a'.repeat(300)))) });
    const b = putProtocol(db, { ownerId: ANNA.id, content: doc(p(t('b'.repeat(300)))) });
    const c = putProtocol(db, { ownerId: ANNA.id, content: doc(p(t('c'.repeat(300)))) });
    const limits: Limits = { ...LIMITS, responseBudget: 100 };
    const out = exchange(db, { docs: [{ id: a }, { id: b }, { id: c }] }, ANNA, peers, Date.now(), limits).docs;
    expect(out.map((r) => r.status)).toEqual(['ok', 'deferred', 'deferred']); // das erste Dokument kommt immer vollständig
    expect(out[0]!.update).toBeDefined();
  });
});

describe('Austausch: Arbeitsgrenzen', () => {
  const big = (id: string, n = 300) => putProtocol(db, { id, ownerId: ANNA.id, content: doc(p(t('a'.repeat(n)))) });

  it('ist das Budget der Antwort verbraucht, wird kein weiteres Dokument angefasst: Seine Änderung bleibt unangewendet', () => {
    const a = big('gross-0001');
    const b = putProtocol(db, { id: 'klein-0001', ownerId: ANNA.id });
    const dev = new Device(ANNA, b, doc(p(t('Neu'))));
    const limits: Limits = { ...LIMITS, responseBudget: 100 };
    const out = exchange(db, { docs: [{ id: a }, dev.request({ create: true })] }, ANNA, peers, Date.now(), limits).docs;
    expect(out.map((r) => r.status)).toEqual(['ok', 'deferred']);
    expect(stored(b)).toBeUndefined(); // nichts angewendet: Das Gerät schickt es beim nächsten Mal noch einmal
  });

  it('ein Ergebnis, das schon berechnet ist, wird geliefert, auch wenn es das Budget sprengt (sonst wäre die Änderung angewendet und die Antwort verloren)', () => {
    const a = big('gross-0001', 50);
    const b = big('gross-0002', 900);
    const dev = new Device(ANNA, b);
    dev.doc.getXmlFragment(FIELD).insert(0, [new Y.XmlElement('paragraph')]); // eine kleine eigene Änderung
    const limits: Limits = { ...LIMITS, responseBudget: 400 };
    const out = exchange(db, { docs: [{ id: a }, dev.request()] }, ANNA, peers, Date.now(), limits).docs;
    expect(out.map((r) => r.status)).toEqual(['ok', 'ok']);
    expect(out[1]!.update!.length).toBeGreaterThan(400);
    expect(JSON.parse(row(b).content).content).toHaveLength(2); // die Änderung des Geräts ist angewendet
  });

  it('ist die Zeit für eine Anfrage verbraucht, kommen die übrigen Dokumente später dran; das erste kommt immer', () => {
    const ids = ['zeit-0001', 'zeit-0002', 'zeit-0003'].map((id) => putProtocol(db, { id, ownerId: ANNA.id }));
    const devs = ids.map((id) => new Device(ANNA, id, doc(p(t(`Text ${id}`)))));
    const limits: Limits = { ...LIMITS, maxMs: 0 };
    const out = exchange(db, { docs: devs.map((d) => d.request({ create: true })) }, ANNA, peers, Date.now(), limits).docs;
    expect(out.map((r) => r.status)).toEqual(['ok', 'deferred', 'deferred']);
    expect(stored(ids[1]!)).toBeUndefined();
    expect(stored(ids[2]!)).toBeUndefined();
  });
});

describe('Austausch: Fehler des Servers', () => {
  it('scheitert das Schreiben unerwartet (Speicher voll, Datenbank gesperrt), ist der Text nicht „abgelehnt“, sondern wird später noch einmal versucht', () => {
    const id = putProtocol(db, { id: 'fehler-0001', ownerId: ANNA.id });
    const dev = new Device(ANNA, id, doc(p(t('Wichtiger Text'))));
    db.exec("CREATE TRIGGER kaputt BEFORE INSERT ON ydocs BEGIN SELECT RAISE(ABORT, 'Platte voll'); END");
    const first = dev.run({ create: true });
    expect(first.status).toBe('deferred'); // ein „rejected“ bliebe auf dem Gerät liegen, bis jemand weiterschreibt
    expect(stored(id)).toBeUndefined(); // zurückgerollt
    db.exec('DROP TRIGGER kaputt');
    expect(dev.run({ create: true }).status).toBe('ok'); // dieselbe Anfrage gelingt, sobald der Fehler behoben ist
    expect(JSON.parse(row(id).content).content[0].content[0].text).toBe('Wichtiger Text');
  });

  it('auch ein Fehler außerhalb des Schreibens (zum Beispiel beim Lesen) macht aus dem Dokument kein „abgelehnt“', () => {
    const id = putProtocol(db, { id: 'fehler-0002', ownerId: ANNA.id });
    const dev = new Device(ANNA, id, doc(p(t('Text'))));
    db.exec('ALTER TABLE ydocs RENAME TO ydocs_weg');
    const logged: string[] = [];
    try {
      const res = exchange(db, { epoch: getEpoch(db), docs: [dev.request({ create: true })] }, ANNA, peers, Date.now(), LIMITS, (docId) => logged.push(docId));
      expect(res.docs.map((r) => r.status)).toEqual(['deferred']);
      expect(logged).toEqual([id]); // der Betreiber erfährt davon (die Route protokolliert es)
    } finally {
      db.exec('ALTER TABLE ydocs_weg RENAME TO ydocs');
    }
    expect(dev.run({ create: true }).status).toBe('ok');
  });
});

describe('Austausch: Anhänge und Mitschreibende', () => {
  it('leitet die Verweise auf Anhänge ab und meldet fehlende', () => {
    const id = putProtocol(db, { ownerId: ANNA.id });
    const anna = new Device(ANNA, id, doc({ type: 'photo', attrs: { blobId: 'blob-abc123', src: '', w: 0, h: 0, caption: '' } }, p()));
    const r = anna.run({ create: true });
    expect(r.missingBlobs).toEqual(['blob-abc123']);
    expect(db.prepare('SELECT blobId FROM blob_refs WHERE protocolId = ?').all(id)).toEqual([{ blobId: 'blob-abc123' }]);
    // entfernt Anna das Foto, verschwindet der Verweis
    anna.doc.getXmlFragment(FIELD).delete(0, 1);
    anna.run();
    expect(db.prepare('SELECT blobId FROM blob_refs WHERE protocolId = ?').all(id)).toEqual([]);
  });

  it('nennt die anderen, die das Protokoll offen haben, und vergisst sie nach der Frist', () => {
    const id = putProtocol(db, { ownerId: ANNA.id, content: doc(p(t('Hallo'))) });
    const anna = new Device(ANNA, id);
    const ben = new Device(BEN, id);
    expect(anna.run({ live: true }, 1_000).peers).toEqual([]);
    expect(ben.run({ live: true }, 2_000).peers).toEqual([ANNA.id]);
    expect(anna.run({ live: true }, 3_000).peers).toEqual([BEN.id]);
    // ohne live erscheint ein Gerät nicht
    const stille = new Device(BEN, id);
    expect(stille.run({}, 4_000).peers).toBeUndefined();
    expect(anna.run({ live: true }, 30_000).peers).toEqual([]);
  });
});
