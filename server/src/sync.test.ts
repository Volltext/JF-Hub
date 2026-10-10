import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type ProtocolRow } from './db.js';
import { putProtocol } from './collab/testing.js';
import { applySync, purgeProtocol, type ClientChange, type MetaAt, type SyncUser } from './sync.js';

const ANNA: SyncUser = { id: 'u-anna', role: 'betreuer' };
const BEN: SyncUser = { id: 'u-ben', role: 'betreuer' };
const ADMIN: SyncUser = { id: 'u-admin', role: 'admin' };

let db: DatabaseSync;
beforeEach(() => {
  db = openDb(':memory:');
});

const T0 = Date.now() - 3_600_000;
const times = (at: number, over: MetaAt = {}): MetaAt => ({ title: at, datum: at, beginn: at, ende: at, ort: at, leitung: at, folderId: at, shared: at, ...over });
const change = (id: string, over: Partial<ClientChange> = {}): ClientChange => ({
  id,
  baseRev: 0,
  title: 'Sitzung',
  datum: '2026-10-01',
  beginn: '',
  ende: '',
  ort: '',
  leitung: '',
  updatedAt: T0,
  deleted: false,
  metaAt: times(T0),
  ...over,
});
const sync = (user: SyncUser, protocols: ClientChange[], since = 0) => applySync(db, { since, protocols }, user);
const row = (id: string) => db.prepare('SELECT * FROM protocols WHERE id = ?').get(id) as unknown as ProtocolRow;
const doc = (res: ReturnType<typeof sync>, id: string) => res.changes.find((c) => c.id === id);

describe('applySync: Protokolle anlegen', () => {
  it('legt ein Protokoll aus den Kopfdaten an: Text leer, Yjs-Modus, Zeiten je Feld', () => {
    const res = sync(ANNA, [change('anna-0001', { title: 'Neu', ort: 'Gerätehaus' })]);
    const d = doc(res, 'anna-0001')!;
    expect(d).toMatchObject({ title: 'Neu', ort: 'Gerätehaus', ymode: 1, deleted: false, shared: false, ownerId: ANNA.id, content: { type: 'doc', content: [] } });
    expect(d.metaAt).toEqual(times(T0));
    expect(res.conflicts).toEqual([]);
    expect(res.missingBlobs).toEqual([]);
  });

  it('ignoriert ein mitgeschicktes `content` und das alte Feld `changes`', () => {
    const withContent = { ...change('anna-0001'), content: { type: 'doc', content: [{ type: 'paragraph' }] } } as ClientChange;
    sync(ANNA, [withContent]);
    expect(row('anna-0001').content).toBe('{"type":"doc","content":[]}');
    // ein Gerät vor 3.0.0 schickte `changes`; das gibt es nicht mehr
    const res = applySync(db, { since: 0, changes: [change('alt-00001')] } as never, ANNA);
    expect(doc(res, 'alt-00001')).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM protocols').get()).toEqual({ n: 1 });
  });

  it('lehnt ungültige Kennungen einzeln ab, die übrigen gelten', () => {
    const res = sync(ANNA, [change('!'), change('gut-00001')]);
    expect(res.rejected).toEqual([{ kind: 'protocol', id: '!', reason: 'ungültige ID' }]);
    expect(doc(res, 'gut-00001')).toBeDefined();
  });

  it('ohne Zeiten gilt die Änderungszeit des Geräts, Zeiten in der Zukunft werden begrenzt', () => {
    const future = Date.now() + 3_600_000;
    sync(ANNA, [change('anna-0001', { metaAt: undefined, updatedAt: T0 }), change('anna-0002', { metaAt: times(future) })]);
    expect(JSON.parse(row('anna-0001').metaAt)).toEqual(times(T0));
    const clamped = JSON.parse(row('anna-0002').metaAt) as MetaAt;
    expect(clamped.title).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 50);
    expect(clamped.title).toBeGreaterThan(Date.now());
  });
});

describe('applySync: Kopfdaten Feld für Feld', () => {
  const shared = () => {
    sync(ANNA, [change('doc-00001', { shared: true })]);
  };

  it('zwei Geräte ändern verschiedene Felder: beide Änderungen gelten', () => {
    shared();
    sync(ANNA, [change('doc-00001', { shared: true, title: 'Neuer Titel', metaAt: { title: T0 + 1000 } })]);
    const res = sync(BEN, [change('doc-00001', { title: 'Sitzung', ort: 'Wache', metaAt: { ort: T0 + 2000 } })]);
    expect(row('doc-00001')).toMatchObject({ title: 'Neuer Titel', ort: 'Wache' });
    expect(doc(res, 'doc-00001')).toMatchObject({ title: 'Neuer Titel', ort: 'Wache' });
    expect(doc(res, 'doc-00001')!.metaAt).toMatchObject({ title: T0 + 1000, ort: T0 + 2000, datum: T0 });
  });

  it('dasselbe Feld: die jüngere Änderung gewinnt, auch wenn sie zuerst eintrifft', () => {
    shared();
    sync(BEN, [change('doc-00001', { title: 'Von Ben', metaAt: { title: T0 + 5000 } })]);
    const res = sync(ANNA, [change('doc-00001', { shared: true, title: 'Von Anna', metaAt: { title: T0 + 1000 } })]);
    expect(row('doc-00001').title).toBe('Von Ben');
    // Anna erfährt es: das Protokoll geht zurück, auch wenn seine Revision nicht über ihrem Stand liegt
    expect(doc(res, 'doc-00001')).toMatchObject({ title: 'Von Ben' });
    const later = sync(ANNA, [change('doc-00001', { title: 'Von Anna', metaAt: { title: T0 + 1000 } })], res.rev);
    expect(doc(later, 'doc-00001')).toMatchObject({ title: 'Von Ben' });
  });

  it('bei gleicher Zeit gewinnt der größere Wert, unabhängig von der Reihenfolge', () => {
    shared();
    const a = change('doc-00001', { title: 'Anna', metaAt: { title: T0 + 1 } });
    const b = change('doc-00001', { title: 'Ben', metaAt: { title: T0 + 1 } });
    sync(ANNA, [a]);
    sync(BEN, [b]);
    expect(row('doc-00001').title).toBe('Ben');
    sync(ANNA, [a]);
    expect(row('doc-00001').title).toBe('Ben');
  });

  it('Felder ohne Zeit behauptet das Gerät nicht', () => {
    shared();
    sync(BEN, [change('doc-00001', { ort: 'Wache', metaAt: { ort: T0 + 10 } })]);
    sync(ANNA, [change('doc-00001', { shared: true, ort: 'veraltet', title: 'Anders', metaAt: { title: T0 + 20 } })]);
    expect(row('doc-00001')).toMatchObject({ ort: 'Wache', title: 'Anders' });
  });

  it('eine Wiederholung ändert nichts mehr (keine neue Revision)', () => {
    shared();
    const c = change('doc-00001', { shared: true, title: 'Neu', metaAt: { title: T0 + 100 } });
    sync(ANNA, [c]);
    const rev = row('doc-00001').rev;
    sync(ANNA, [c]);
    expect(row('doc-00001').rev).toBe(rev);
  });

  it('eine Zeit in der Zukunft gewinnt höchstens fünf Minuten lang', () => {
    shared();
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(start);
      sync(BEN, [change('doc-00001', { title: 'Zukunft', metaAt: { title: start + 86_400_000 } })]);
      expect((JSON.parse(row('doc-00001').metaAt) as MetaAt).title).toBe(start + 5 * 60_000);
      vi.setSystemTime(start + 10 * 60_000);
      sync(ANNA, [change('doc-00001', { shared: true, title: 'Später ehrlich', metaAt: { title: start + 10 * 60_000 } })]);
      expect(row('doc-00001').title).toBe('Später ehrlich');
    } finally {
      vi.useRealTimers();
    }
  });

  it('die Sichtbarkeit ändert nur der Besitzer', () => {
    shared();
    sync(BEN, [change('doc-00001', { shared: false, metaAt: { shared: T0 + 50 } })]);
    expect(row('doc-00001').shared).toBe(1);
    sync(ANNA, [change('doc-00001', { shared: false, metaAt: { shared: T0 + 60 } })]);
    expect(row('doc-00001').shared).toBe(0);
  });

  it('zieht der Besitzer das Protokoll zurück, bekommen andere Geräte einen Löschhinweis', () => {
    shared();
    const seen = sync(BEN, []);
    expect(doc(seen, 'doc-00001')).toBeDefined();
    const hide = sync(ANNA, [change('doc-00001', { shared: false, metaAt: { shared: T0 + 50 } })]);
    const next = sync(BEN, [], seen.rev);
    expect(doc(next, 'doc-00001')).toMatchObject({ deleted: true, title: '' });
    expect(hide.rev).toBeGreaterThan(seen.rev);
  });

  it('fremde private Protokolle bleiben unberührt', () => {
    sync(ANNA, [change('privat-001')]);
    const res = sync(BEN, [change('privat-001', { title: 'Übernommen', metaAt: { title: T0 + 5 } })]);
    expect(row('privat-001').title).toBe('Sitzung');
    expect(doc(res, 'privat-001')).toBeUndefined();
  });

  it('Protokolle mit noch nicht umgestelltem Text nehmen Kopfdaten an, der Text bleibt', () => {
    putProtocol(db, { id: 'alt-00001', ownerId: ANNA.id, ymode: 0, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alt' }] }] } });
    const res = sync(ANNA, [change('alt-00001', { title: 'Neu', metaAt: { title: T0 + 1 } })]);
    expect(row('alt-00001').title).toBe('Neu');
    expect(row('alt-00001').content).toContain('alt');
    expect(doc(res, 'alt-00001')).toMatchObject({ ymode: 0 });
  });
});

describe('applySync: Löschen, Papierkorb, Leeren', () => {
  it('Besitzer und Admin löschen, andere nicht; Löschen schreibt keinen Inhalt', () => {
    sync(ANNA, [change('doc-00001', { shared: true })]);
    sync(BEN, [change('doc-00001', { deleted: true })]);
    expect(row('doc-00001').deletedAt).toBeNull();
    const rev = row('doc-00001').rev;
    const res = sync(ANNA, [change('doc-00001', { deleted: true, title: 'wird ignoriert' })]);
    expect(row('doc-00001')).toMatchObject({ title: 'Sitzung' });
    expect(row('doc-00001').deletedAt).not.toBeNull();
    expect(row('doc-00001').rev).toBeGreaterThan(rev);
    expect(doc(res, 'doc-00001')).toMatchObject({ deleted: true });
    sync(ANNA, [change('doc-00002', { shared: true })]);
    sync(ADMIN, [change('doc-00002', { deleted: true })]);
    expect(row('doc-00002').deletedAt).not.toBeNull();
  });

  it('eine Änderung, die älter ist als das Löschen, holt nichts zurück; eine jüngere schon', () => {
    sync(ANNA, [change('doc-00001')]);
    sync(ANNA, [change('doc-00001', { deleted: true })]);
    const stale = sync(ANNA, [change('doc-00001', { title: 'Alt', metaAt: { title: T0 + 1 } })]);
    expect(row('doc-00001').deletedAt).not.toBeNull();
    expect(doc(stale, 'doc-00001')).toMatchObject({ deleted: true }); // das Gerät erfährt es
    const fresh = sync(ANNA, [change('doc-00001', { title: 'Neu', metaAt: { title: Date.now() + 1000 } })]);
    expect(row('doc-00001')).toMatchObject({ title: 'Neu', deletedAt: null });
    expect(doc(fresh, 'doc-00001')).toMatchObject({ deleted: false, title: 'Neu' });
  });

  it('ein geleerter Eintrag lebt durch eine jüngere Änderung wieder auf, ohne Text und ohne Zustand', () => {
    putProtocol(db, { id: 'doc-00001', ownerId: ANNA.id, deleted: true, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inhalt' }] }] } });
    expect(purgeProtocol(db, 'doc-00001')).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ydocs').get()).toEqual({ n: 0 });
    const stale = sync(ANNA, [change('doc-00001', { metaAt: { title: T0 } })]);
    expect(row('doc-00001').purgedAt).not.toBeNull();
    expect(doc(stale, 'doc-00001')).toMatchObject({ deleted: true });
    const back = sync(ANNA, [change('doc-00001', { title: 'Mein Stand', metaAt: { title: Date.now() + 1000 } })]);
    expect(doc(back, 'doc-00001')).toMatchObject({ deleted: false, title: 'Mein Stand', ymode: 1, content: { type: 'doc', content: [] } });
    expect(row('doc-00001').purgedAt).toBeNull();
  });

  it('ein geleerter Eintrag lebt mit allen Feldern des Geräts wieder auf, auch mit denen, deren Zeit älter ist als das Leeren', () => {
    // Das Leeren hat Titel und Ort gelöscht, ihre Feldzeiten aber stehen lassen. Ein Gerät, das danach etwas ändert und dabei seinen älteren
    // Titel mitschickt, bekäme sonst einen leeren Titel zurück, obwohl niemand nach dem Leeren etwas an ihm geändert hat.
    putProtocol(db, { id: 'doc-00001', ownerId: ANNA.id, deleted: true, title: 'Alter Titel', metaAt: times(Date.now() - 1000) });
    expect(purgeProtocol(db, 'doc-00001')).toBe(true);
    const back = sync(ANNA, [change('doc-00001', { title: 'Mein Titel', ort: 'Gerätehaus', metaAt: times(T0, { datum: Date.now() + 1000 }) })]);
    expect(doc(back, 'doc-00001')).toMatchObject({ deleted: false, title: 'Mein Titel', ort: 'Gerätehaus' });
  });

  it('Löschen eines schon gelöschten Protokolls schickt es dem Gerät noch einmal', () => {
    sync(ANNA, [change('doc-00001')]);
    sync(ANNA, [change('doc-00001', { deleted: true })]);
    const rev = row('doc-00001').rev;
    const res = sync(ANNA, [change('doc-00001', { deleted: true })], rev);
    expect(doc(res, 'doc-00001')).toMatchObject({ deleted: true });
    expect(row('doc-00001').rev).toBe(rev);
  });
});
