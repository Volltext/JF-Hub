import { describe, expect, it } from 'vitest';
import { deriveId } from '@/core/domain/id';
import type { Draft } from './model';
import { applyPending, enqueue, rebase, type DraftOp, type PendingOp } from './ops';
import { ClockOffset, toLocal, toServer } from './live';
import { emptyDraft, nextSessionId, normalizeDraft, reset, start } from './stopwatch';

let n = 0;
const op = (d: Draft, o: DraftOp, at = 0, session = d.id): PendingOp => ({ id: `op-${++n}`, session, at, op: o });

describe('Lauf-Kennungen', () => {
  it('sind abgeleitet: gleich auf jedem Gerät, verschieden je Modus und nach jedem Zurücksetzen', () => {
    expect(emptyDraft('a').id).toBe(emptyDraft('a').id);
    expect(emptyDraft('a').id).not.toBe(emptyDraft('b').id);
    const once = reset(emptyDraft('a')).id;
    expect(once).toBe(nextSessionId(emptyDraft('a').id));
    expect(reset(reset(emptyDraft('a'))).id).not.toBe(once);
    expect(deriveId('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(deriveId('x', 'y')).not.toBe(deriveId('xy'));
  });
});

describe('Eingaben', () => {
  it('werden mit ID im Stand vermerkt und nie doppelt angewendet', () => {
    const d = emptyDraft('a');
    const p = op(d, { type: 'fehler', errorId: 'a-q-psa', delta: 1 });
    const once = applyPending(d, p);
    expect(once.fehlerCounts).toEqual({ 'a-q-psa': 1 });
    expect(once.opIds).toEqual([p.id]);
    expect(applyPending(once, p)).toBe(once);
  });

  it('gehören zu einem Lauf: nach dem Zurücksetzen durch jemand anderen entfallen sie', () => {
    const d = start(emptyDraft('a'), 0);
    const stale = op(d, { type: 'stop' }, 5000);
    expect(applyPending(reset(d), stale)).toEqual(reset(d));
  });

  it('ohne Wirkung werden nicht vermerkt (Start bei laufender Uhr, gleicher Wert)', () => {
    const d = start(emptyDraft('a'), 0);
    expect(applyPending(d, op(d, { type: 'start' }, 10))).toBe(d);
    expect(applyPending(d, op(d, { type: 'set', patch: { notes: '' } }))).toBe(d);
  });

  it('setzen statt umschalten: zweimal „Wertung an“ bleibt an', () => {
    const d = emptyDraft('a');
    const on1 = op(d, { type: 'set', patch: { scoringEnabled: true } });
    const on2 = op(d, { type: 'set', patch: { scoringEnabled: true } });
    expect(rebase(d, [on1, on2]).draft.scoringEnabled).toBe(true);
  });
});

describe('rebase', () => {
  it('setzt eigene Eingaben auf den Stand eines anderen Geräts', () => {
    const base = emptyDraft('a');
    const mine = op(base, { type: 'fehler', errorId: 'x', delta: 1 });
    const theirs = applyPending(base, op(base, { type: 'fehler', errorId: 'y', delta: 1 }));
    const { draft, ops } = rebase(theirs, [mine]);
    expect(draft.fehlerCounts).toEqual({ x: 1, y: 1 });
    expect(ops).toEqual([mine]);
  });

  it('lässt weg, was der Stand schon enthält, und hält die Reihenfolge ein', () => {
    const base = emptyDraft('a');
    const a = op(base, { type: 'start' }, 1000);
    const b = op(base, { type: 'stop' }, 4000);
    const server = applyPending(base, a); // a ist schon angekommen
    const { draft, ops } = rebase(server, [a, b]);
    expect(ops).toEqual([b]);
    expect(draft).toMatchObject({ isRunning: false, elapsedMs: 3000 });
  });

  it('Zurücksetzen + Start: setzt ein anderer denselben Lauf zurück, zählt der Start im neuen Lauf trotzdem', () => {
    const base = emptyDraft('a');
    const myReset = op(base, { type: 'reset' });
    const myStart = op(reset(base), { type: 'start' }, 2000);
    const theirReset = applyPending(base, op(base, { type: 'reset' }));
    const { draft, ops } = rebase(theirReset, [myReset, myStart]);
    expect(ops).toEqual([myStart]);
    expect(draft).toMatchObject({ id: nextSessionId(base.id), isRunning: true, startTimestamp: 2000 });
  });
});

describe('enqueue', () => {
  it('fasst Tippen in ein Feld zusammen, aber nicht, was schon unterwegs ist', () => {
    const d = emptyDraft('a');
    const t1 = op(d, { type: 'set', patch: { notes: 'H' } });
    const t2 = op(d, { type: 'set', patch: { notes: 'Ha' } });
    const t3 = op(d, { type: 'set', patch: { notes: 'Hal' } });
    expect(enqueue([t1], t2, new Set())).toEqual([t2]);
    expect(enqueue([t1], t2, new Set([t1.id]))).toEqual([t1, t2]);
    const f = op(d, { type: 'fehler', errorId: 'x', delta: 1 });
    expect(enqueue([t2, f], t3, new Set())).toEqual([t2, f, t3]);
  });
});

describe('Uhrenabgleich', () => {
  it('schätzt den Abstand aus der schnellsten Antwort und rechnet Wartezeit am Server heraus', () => {
    const c = new ClockOffset();
    expect(c.offset).toBeNull();
    // Server geht 5 s vor; Antwort nach 400 ms, davon 300 ms am Server gewartet → Netz 100 ms, Hälfte zurück.
    c.sample(10_000, 10_400, 15_350, 300);
    expect(c.offset).toBe(5000);
    // Langsame Antwort (800 ms ohne Warten) ist ungenauer und zählt nicht.
    c.sample(20_000, 20_800, 25_100);
    expect(c.offset).toBe(5000);
    c.sample(30_000, 30_000, 'kaputt');
    expect(c.offset).toBe(5000);
  });

  it('rechnet nur den Startzeitpunkt einer laufenden Uhr um', () => {
    const running = start(emptyDraft('a'), 1000);
    expect(toServer(running, 250).startTimestamp).toBe(1250);
    expect(toLocal(toServer(running, 250), 250)).toEqual(running);
    const stopped = emptyDraft('a');
    expect(toServer(stopped, 250)).toBe(stopped);
  });
});

describe('normalizeDraft', () => {
  it('ergänzt fehlende Felder und ersetzt Unbrauchbares', () => {
    expect(normalizeDraft('a', null)).toEqual(emptyDraft('a'));
    const d = normalizeDraft('b', { isRunning: true, startTimestamp: 'x', markers: 'kaputt', fehlerCounts: [], opIds: 5, notes: 3 });
    expect(d).toMatchObject({ mode: 'b', isRunning: false, startTimestamp: null, markers: [], fehlerCounts: {}, notes: '' });
    expect(d.opIds).toBeUndefined();
    expect(normalizeDraft('a', { mode: 'b', id: 'lauf-1' })).toMatchObject({ mode: 'a', id: 'lauf-1' });
  });
});
