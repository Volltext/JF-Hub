import type { Draft } from './model';
import { describe, expect, it } from 'vitest';
import {
  addFehler,
  addSplit,
  elapsedOf,
  emptyDraft,
  formatClock,
  hasData,
  maskTime,
  parseTargetSeconds,
  removeFehler,
  removeMarker,
  reset,
  resetTaskTimer,
  start,
  stop,
} from './stopwatch';

describe('Start/Stopp', () => {
  it('misst über Stopp und erneuten Start hinweg', () => {
    let d = start(emptyDraft('a'), 1000);
    expect(elapsedOf(d, 3500)).toBe(2500);
    d = stop(d, 3500);
    expect(d).toMatchObject({ isRunning: false, startTimestamp: null, elapsedMs: 2500 });
    expect(elapsedOf(d, 99999)).toBe(2500);
    d = start(d, 10_000);
    expect(elapsedOf(d, 11_000)).toBe(3500);
  });

  it('ist idempotent und verträgt rückwärts springende Uhren', () => {
    const d = start(emptyDraft('a'), 5000);
    expect(start(d, 6000)).toBe(d);
    expect(elapsedOf(d, 4000)).toBe(0);
    expect(stop(emptyDraft('a'), 1)).toEqual(emptyDraft('a'));
  });

  it('übersteht einen App-Neustart: der gespeicherte laufende Zustand rechnet weiter', () => {
    const saved = JSON.parse(JSON.stringify(start(emptyDraft('b'), 1000)));
    expect(elapsedOf(saved, 61_000)).toBe(60_000);
  });
});

describe('A-Teil: Zwischenzeiten und Knotenzeit', () => {
  it('berechnet die Knotenzeit beim Stopp', () => {
    let d = start(emptyDraft('a'), 0);
    d = addSplit(d, 'zu Wasser', 30_000);
    d = addSplit(d, 'Knoten Start', 50_000);
    d = stop(d, 62_000);
    expect(d.knotDurationMs).toBe(12_000);
    expect(d.markers.map((m) => m.label)).toEqual(['Knoten Start', 'zu Wasser']);
  });

  it('„Knoten Start“ nur einmal, Marker nur bei laufender Uhr', () => {
    let d = addSplit(emptyDraft('a'), 'zu Wasser', 0);
    expect(d.markers).toHaveLength(0);
    d = start(d, 0);
    d = addSplit(addSplit(d, 'Knoten Start', 1000), 'Knoten Start', 2000);
    expect(d.markers).toHaveLength(1);
    expect(d.knotStartElapsedMs).toBe(1000);
  });

  it('Entfernen von „Knoten Start“ setzt die Knotenmessung zurück', () => {
    let d = start(emptyDraft('a'), 0);
    d = addSplit(d, 'Knoten Start', 1000);
    d = removeMarker(d, d.markers[0]!.id);
    expect(d).toMatchObject({ knotStartElapsedMs: null, knotDurationMs: null, markers: [] });
  });
});

describe('B-Teil: Aufgaben-Timer', () => {
  it('erstes Tippen startet, zweites stoppt, drittes tut nichts', () => {
    let d = start(emptyDraft('b'), 0);
    d = addSplit(d, 'Anziehen', 10_000);
    expect(d.taskTimers['Anziehen']).toEqual({ startElapsedMs: 10_000, endElapsedMs: null });
    d = addSplit(d, 'Anziehen', 25_000);
    expect(d.taskTimers['Anziehen']!.endElapsedMs).toBe(25_000);
    expect(addSplit(d, 'Anziehen', 40_000)).toBe(d);
  });

  it('lässt sich zurücksetzen', () => {
    let d = start(emptyDraft('b'), 0);
    d = resetTaskTimer(addSplit(d, 'Anziehen', 1000), 'Anziehen');
    expect(d.taskTimers).toEqual({});
  });
});

describe('Fehler', () => {
  it('zählt hoch und runter und räumt bei 0 auf', () => {
    let d = addFehler(addFehler(emptyDraft('a'), 'x'), 'x');
    expect(d.fehlerCounts).toEqual({ x: 2 });
    d = removeFehler(removeFehler(d, 'x'), 'x');
    expect(d.fehlerCounts).toEqual({});
    expect(removeFehler(d, 'x')).toBe(d);
  });
});

describe('Zurücksetzen', () => {
  it('leert Messdaten, behält aber Wertungs-Einstellungen', () => {
    let d: Draft = { ...emptyDraft('a'), scoringEnabled: true, targetSeconds: 90 };
    d = addFehler(start(d, 0), 'x');
    expect(hasData(d, 5000)).toBe(true);
    const r = reset(d);
    expect(r).toMatchObject({ scoringEnabled: true, targetSeconds: 90, isRunning: false, fehlerCounts: {} });
    expect(hasData(r, 5000)).toBe(false);
  });
});

describe('Eingabe und Anzeige', () => {
  it('maskiert und parst Zeiten', () => {
    expect(maskTime('1a2b3')).toBe('1:23');
    expect(maskTime('12345')).toBe('12:34');
    expect(parseTargetSeconds('1:30')).toBe(90);
    expect(parseTargetSeconds('45')).toBe(45);
    expect(parseTargetSeconds('')).toBeNull();
    expect(parseTargetSeconds('0:00')).toBeNull();
  });

  it('formatiert mm:ss,d', () => {
    expect(formatClock(0)).toBe('00:00,0');
    expect(formatClock(61_234)).toBe('01:01,2');
    expect(formatClock(61_234, false)).toBe('01:01');
    expect(formatClock(-5)).toBe('00:00,0');
  });
});

describe('Wasserentnahme', () => {
  it('Zurücksetzen behält die gewählte Variante', () => {
    const d: Draft = { ...emptyDraft('a'), wasserentnahme: 'hydrant' };
    expect(reset(d).wasserentnahme).toBe('hydrant');
  });
});
