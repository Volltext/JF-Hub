import type { Draft } from './model';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/core/db/db';
import { exportBackup, importBackup } from '@/core/db/backup';
import { seedOutboxOnce } from '@/core/db/outbox';
import { wipeLocalData } from '@/core/db/wipe';
import { buildRun, canSave } from './run';
import { loadDraft, loadLineup, runRepo, saveDraft, saveLineup, templateRepo } from './store';
import { addFehler, emptyDraft, start, stop } from './stopwatch';

beforeEach(async () => {
  await Promise.all([db.members.clear(), db.runs.clear(), db.lineupTemplates.clear(), db.outbox.clear(), db.kv.clear()]);
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

  it('Lauf speichern behält die Aufstellung als Schnappschuss', async () => {
    await db.members.add({ id: 'm1', name: 'Anna', kind: 'jugendlich', active: true });
    await saveLineup({ 'a-melder': 'm1' });
    const d = stop(start(emptyDraft('a'), 0), 80_000);
    await saveDraft(d);

    const run = await runRepo.saveFromDraft(d, 'gruppe', 80_000);
    expect(run.lineupSnapshot.assignments['a-melder']).toBe('m1');
    expect(run.lineupSnapshot.memberNames['m1']).toBe('Anna');
    expect(await db.runs.count()).toBe(1);
  });

  it('derselbe Stand zweimal gespeichert (zwei Geräte gleichzeitig) ergibt einen Lauf, ein anderer einen zweiten', async () => {
    const d = { ...stop(start(emptyDraft('a'), 0), 80_000), opIds: ['op-1', 'op-2'] };
    const first = await runRepo.saveFromDraft(d, 'gruppe', 80_000);
    const again = await runRepo.saveFromDraft({ ...d }, 'gruppe', 80_000);
    expect(again.id).toBe(first.id);
    expect(await db.runs.count()).toBe(1);

    await runRepo.saveFromDraft({ ...d, opIds: ['op-1', 'op-2', 'op-3'], elapsedMs: 81_000 }, 'gruppe', 81_000);
    expect(await db.runs.count()).toBe(2);
  });
});

describe('Abgleich mit dem Server', () => {
  it('merkt Läufe und Vorlagen zum Senden vor, auch beim Ändern und Löschen', async () => {
    const d = stop(start(emptyDraft('a'), 0), 80_000);
    await saveDraft(d);
    const run = await runRepo.saveFromDraft(d, 'gruppe', 80_000);
    const tpl = await templateRepo.add('Standard', {});
    expect((await db.outbox.toArray()).map((o) => o.key).sort()).toEqual([`lineupTemplates:${tpl.id}`, `runs:${run.id}`].sort());

    await db.outbox.clear();
    await runRepo.updateNotes(run.id, 'Knoten klemmt');
    expect(await db.outbox.get(`runs:${run.id}`)).toMatchObject({ deleted: 0 });

    await runRepo.remove(run.id);
    await templateRepo.remove(tpl.id);
    expect(await db.outbox.get(`runs:${run.id}`)).toMatchObject({ deleted: 1 });
    expect(await db.outbox.get(`lineupTemplates:${tpl.id}`)).toMatchObject({ deleted: 1 });
  });

  it('trägt bestehende Läufe auf Geräten nach, die schon abgeglichen haben (einmalig)', async () => {
    await db.kv.put({ key: 'records.seeded', value: true });
    await db.runs.add({ id: 'run-alt', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', mode: 'a', totalMs: 1, markers: [], knotDurationMs: null, taskTimers: {}, notes: '', scoring: null, lsp: null, lineupSnapshot: { assignments: {}, memberNames: {} } });
    await seedOutboxOnce();
    expect((await db.outbox.toArray()).map((o) => o.key)).toEqual(['runs:run-alt']);
    await db.outbox.clear();
    await seedOutboxOnce();
    expect(await db.outbox.count()).toBe(0);
  });

  it('Abmelden entfernt auch Läufe und Vorlagen vom Gerät (liegen auf dem Server)', async () => {
    await db.runs.add({ id: 'run-1', createdAt: '', updatedAt: '', mode: 'a', totalMs: 1, markers: [], knotDurationMs: null, taskTimers: {}, notes: '', scoring: null, lsp: null, lineupSnapshot: { assignments: {}, memberNames: {} } });
    await db.lineupTemplates.add({ id: 't1', name: 'x', createdAt: '', assignments: {} });
    await saveDraft(start(emptyDraft('a'), 5));
    await db.kv.bulkPut([
      { key: 'draftSync', value: { since: 3 } },
      { key: 'draftSync.a', value: { ops: [] } },
    ]);
    await wipeLocalData();
    expect(await db.runs.count()).toBe(0);
    expect(await db.lineupTemplates.count()).toBe(0);
    // Die laufende Stoppuhr gehört zum Gerät und bleibt, ihr Live-Abgleich gehört zum Konto und geht.
    expect((await loadDraft('a')).isRunning).toBe(true);
    expect(await db.kv.where('key').startsWith('draftSync').count()).toBe(0);
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
