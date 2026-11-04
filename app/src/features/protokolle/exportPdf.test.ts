import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/core/db/db';
import { newProtokoll } from './model';

const syncNow = vi.fn(async (): Promise<null> => null);
vi.mock('./sync', () => ({ scheduleSync: vi.fn(), syncNow: () => syncNow() }));
const request = vi.fn(async () => 'JVBERi0=');
vi.mock('./http', async () => ({ ProtoError: (await vi.importActual<typeof import('./http')>('./http')).ProtoError, loadConn: async () => ({ url: 'https://hub.example', token: 't' }), request: () => request() }));
const shareBinaryFile = vi.fn(async () => {});
vi.mock('@/core/native/files', () => ({ shareBinaryFile: (...a: unknown[]) => shareBinaryFile(...(a as [])) }));
import { exportPdf } from './repo';

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([db.protokolle.clear(), db.ydocs.clear(), db.kv.clear()]);
});

describe('exportPdf', () => {
  it('gleicht ab und lädt dann das PDF', async () => {
    const p = { ...newProtokoll(), title: 'Sitzung', dirty: 0 as const, rev: 3 };
    await db.protokolle.add(p);
    await exportPdf(p.id);
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(shareBinaryFile).toHaveBeenCalledWith(expect.stringContaining('Sitzung'), 'JVBERi0=', 'application/pdf');
  });

  it('versucht es noch einmal, wenn ein schon laufender Abgleich vor dem letzten Speichern begonnen hatte', async () => {
    const p = { ...newProtokoll(), title: 'Sitzung' }; // dirty: ungesendete Änderung
    await db.protokolle.add(p);
    // Der erste Abgleich (ein schon laufender) schickt die letzte Änderung nicht mit, der zweite schon.
    syncNow.mockImplementationOnce(async () => null).mockImplementationOnce(async () => {
      await db.protokolle.update(p.id, { dirty: 0 });
      return null;
    });
    await exportPdf(p.id);
    expect(syncNow).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('auch ungesendeter Text zählt: Das PDF entsteht erst, wenn er beim Server ist', async () => {
    const p = { ...newProtokoll(), title: 'Sitzung', dirty: 0 as const, rev: 3 };
    await db.protokolle.add(p);
    await db.ydocs.put({ id: p.id, update: new Uint8Array([0, 0]), dirty: 1, seq: 1 });
    syncNow.mockImplementationOnce(async () => null).mockImplementationOnce(async () => {
      await db.ydocs.update(p.id, { dirty: 0 });
      return null;
    });
    await exportPdf(p.id);
    expect(syncNow).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('bleibt der Text ungesendet (kein Netz), gibt es kein PDF', async () => {
    const p = { ...newProtokoll(), title: 'Sitzung', dirty: 0 as const, rev: 3 };
    await db.protokolle.add(p);
    await db.ydocs.put({ id: p.id, update: new Uint8Array([0, 0]), dirty: 1, seq: 1 });
    await expect(exportPdf(p.id)).rejects.toThrow(/Verbindung zum Server/);
    expect(request).not.toHaveBeenCalled();
  });

  it('ohne Verbindung (Änderung bleibt ungesendet) gibt es eine verständliche Meldung und kein PDF', async () => {
    const p = newProtokoll();
    await db.protokolle.add(p);
    await expect(exportPdf(p.id)).rejects.toThrow(/Verbindung zum Server/);
    expect(syncNow).toHaveBeenCalledTimes(2);
    expect(request).not.toHaveBeenCalled();
  });

  it('ein unbekanntes Protokoll wird gemeldet', async () => {
    await expect(exportPdf('gibt-es-nicht')).rejects.toThrow(/nicht gefunden/);
  });
});
