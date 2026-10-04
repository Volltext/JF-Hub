import type { Draft } from './model';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db/db';
import { exportBackup, importBackup } from '@/core/db/backup';
import { buildRun, canSave } from './run';
import { loadDraft, loadLineup, runRepo, saveDraft, saveLineup } from './store';
import { addFehler, emptyDraft, start, stop } from './stopwatch';

beforeEach(async () => {
  await Promise.all([db.members.clear(), db.runs.clear(), db.lineupTemplates.clear(), db.kv.clear()]);
});

describe('buildRun', () => {
  const args = { now: 100_000, assignments: {}, memberNames: {}, lspVariante: 'gruppe' };

  it('BW: erzeugt die Wertung nur, wenn sie aktiviert ist', () => {
    let d: Draft = { ...emptyDraft('a'), targetSeconds: 90 };
    d = addFehler(stop(start(d, 0), 95_000), 'a-q-psa');
    expect(buildRun(d, args).scoring).toBeNull();

    const run = buildRun({ ...d, scoringEnabled: true }, args);
    expect(run.scoring).toMatchObject({ vorgabe: 1000, fehlerpunkte: 10, timeAdjust: -5, total: 985 });
    expect(run.lsp).toBeNull();
    expect(run.totalMs).toBe(95_000);
  });

  it('LSP: Wertung nach Tabelle, Nullwertung sticht', () => {
    const d = stop(start(emptyDraft('lsp-schnelligkeit'), 0), 58_400);
    const run = buildRun(d, args);
    expect(run.lsp).toMatchObject({ variante: 'gruppe', punkte: 3, nullwertung: false });
    expect(run.scoring).toBeNull();

    const nw = buildRun({ ...d, nullwertungIds: ['lsp-schnelligkeit-nw-zeit'] }, args);
    expect(nw.lsp).toMatchObject({ punkte: 0, nullwertung: true });
  });

  it('LSP Löschangriff: übernimmt gezählte Beobachtungen aus dem A-Teil-Katalog', () => {
    const d = addFehler({ ...emptyDraft('lsp-loeschangriff'), judgePoints: 3 }, 'a-q-psa');
    const run = buildRun(d, args);
    expect(run.lsp!.punkte).toBe(3);
    expect(run.lsp!.beobachtungen[0]).toMatchObject({ id: 'a-q-psa', total: 10 });
  });
});

describe('canSave', () => {
  it('verlangt eine gestoppte Zeit; bei LSP genügt ein Messwert', () => {
    expect(canSave(emptyDraft('a'), 0)).toBe(false);
    expect(canSave(start(emptyDraft('a'), 0), 5000)).toBe(false);
    expect(canSave(stop(start(emptyDraft('a'), 0), 5000), 9000)).toBe(true);
    expect(canSave({ ...emptyDraft('lsp-kugelstossen'), measuredCm: 6000 }, 0)).toBe(true);
  });
});

describe('Speicher', () => {
  it('Entwurf überlebt „Neustart“, auch laufend', async () => {
    await saveDraft(start(emptyDraft('b'), 1234));
    const d = await loadDraft('b');
    expect(d).toMatchObject({ isRunning: true, startTimestamp: 1234 });
  });

  it('Aufstellung ergänzt neue Positionen als frei', async () => {
    await db.kv.put({ key: 'lineup.current', value: { 'a-melder': 'm1' } });
    const a = await loadLineup();
    expect(a['a-melder']).toBe('m1');
    expect(a['b-laeufer-1']).toBeNull();
  });

  it('Lauf speichern setzt die Uhr zurück und behält die Aufstellung als Schnappschuss', async () => {
    await db.members.add({ id: 'm1', name: 'Anna', kind: 'jugendlich', active: true });
    await saveLineup({ 'a-melder': 'm1' });
    const d = stop(start(emptyDraft('a'), 0), 80_000);
    await saveDraft(d);

    const run = await runRepo.saveFromDraft(d, 'gruppe', 80_000);
    expect(run.lineupSnapshot.assignments['a-melder']).toBe('m1');
    expect(run.lineupSnapshot.memberNames['m1']).toBe('Anna');
    expect((await loadDraft('a')).elapsedMs).toBe(0);
    expect(await db.runs.count()).toBe(1);
  });
});

describe('Backup (v3)', () => {
  it('sichert Läufe, Vorlagen und Aufstellung', async () => {
    await saveLineup({ 'a-melder': 'm1' });
    await db.runs.add({ ...buildRun(stop(start(emptyDraft('a'), 0), 1000), { now: 1000, assignments: {}, memberNames: {}, lspVariante: 'gruppe' }) });
    const backup = await exportBackup();
    await Promise.all([db.runs.clear(), db.kv.clear()]);
    await importBackup(backup);
    expect(await db.runs.count()).toBe(1);
    expect((await loadLineup())['a-melder']).toBe('m1');
  });
});

describe('runTitle', () => {
  it('zeigt die Zeit nur bei Zeit-Disziplinen', async () => {
    const { runTitle } = await import('./run');
    expect(runTitle({ mode: 'a', totalMs: 61_234 })).toBe('A-Teil · 01:01,2');
    expect(runTitle({ mode: 'lsp-kugelstossen', totalMs: 0 })).toBe('Kugelstoßen');
    expect(runTitle({ mode: 'lsp-fragen', totalMs: 0 })).toBe('Fragenbeantwortung');
  });
});

describe('Moduswechsel (Regression: Wechsel zur Leistungsspange)', () => {
  it('liefert nur Entwürfe des gewünschten Modus', async () => {
    const { draftForMode } = await import('./useDraft');
    const a = emptyDraft('a');
    expect(draftForMode(a, 'a')).toBe(a);
    expect(draftForMode(a, 'lsp-schnelligkeit')).toBeNull();
    expect(draftForMode(null, 'a')).toBeNull();
  });

  it('LSP-Wertung eines BW-Entwurfs ist null statt eines Absturzes', async () => {
    const { lspWertung } = await import('./run');
    expect(lspWertung(emptyDraft('a'), 'gruppe', 0)).toBeNull();
  });
});
