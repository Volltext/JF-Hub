import { beforeEach, describe, expect, it, vi } from 'vitest';
import { putLocalBlob } from '@/core/db/blobs';
import { db } from '@/core/db/db';
import { newProtokoll } from './model';
import { useSyncStatus } from './syncStatus';

type Conn = { url: string; token: string | null };
let conn: Conn = { url: 'https://hub.example', token: 't' };
const request = vi.fn();
vi.mock('./http', async () => {
  const actual = await vi.importActual<typeof import('./http')>('./http');
  return { ProtoError: actual.ProtoError, loadConn: async () => conn, request: (...a: unknown[]) => request(...a) };
});
import { ProtoError } from './http';
import { syncNow } from './sync';

const reply = (over: Record<string, unknown> = {}) => ({ rev: 1, changes: [], folders: [], records: [], conflicts: [], api: 3, ...over });
const status = () => useSyncStatus.getState();

beforeEach(async () => {
  request.mockReset();
  conn = { url: 'https://hub.example', token: 't' };
  useSyncStatus.setState({ state: 'off', message: '', lastSyncAt: null, counts: null });
  await Promise.all([db.protokolle.clear(), db.folders.clear(), db.outbox.clear(), db.blobs.clear(), db.blobData.clear(), db.kv.clear()]);
  // Ein Gerät, das sich schon einmal mit einem aktuellen Server abgeglichen hat (sonst käme ein vollständiger Abgleich mit Nachlauf).
  await db.kv.put({ key: 'protokolle.serverRecords', value: true });
});

describe('syncNow', () => {
  it('ohne Server oder Anmeldung passiert nichts und der Zustand ist „off“', async () => {
    conn = { url: '', token: null };
    expect(await syncNow()).toBeNull();
    expect(status().state).toBe('off');
    expect(request).not.toHaveBeenCalled();
  });

  it('gelingt: Zustand „idle“, Zeitpunkt und Zähler werden gemerkt', async () => {
    request.mockResolvedValue(reply({ counts: { protocols: 2, folders: 1, records: 0 } }));
    const res = await syncNow();
    expect(res).toMatchObject({ pushed: 0, conflicts: 0, rejected: 0 });
    expect(status()).toMatchObject({ state: 'idle', message: '', counts: { protocols: 2, folders: 1, records: 0 } });
    expect(status().lastSyncAt).toBeGreaterThan(0);
    expect(request).toHaveBeenCalledWith(expect.anything(), 'POST', '/api/sync', expect.objectContaining({ since: 0 }));
  });

  it('läuft nie doppelt: ein Aufruf während eines Laufs bekommt denselben Lauf und löst genau einen weiteren aus', async () => {
    let release: (v: unknown) => void = () => {};
    request.mockImplementationOnce(() => new Promise((resolve) => (release = resolve))).mockResolvedValue(reply());
    const first = syncNow();
    const second = syncNow();
    const third = syncNow();
    expect(second).toBe(first);
    expect(third).toBe(first);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1)); // noch läuft der erste
    release(reply());
    await first;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2)); // die beiden Anfragen zusammen: ein Nachlauf
    await new Promise((r) => setTimeout(r, 20));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('übersetzt Fehler in Zustände: offline, neu anmelden, Fehler mit Meldung', async () => {
    request.mockRejectedValueOnce(new ProtoError('Keine Verbindung zum Server.', 0));
    expect(await syncNow()).toBeNull();
    expect(status()).toMatchObject({ state: 'offline', message: '' });

    request.mockRejectedValueOnce(new ProtoError('Nicht angemeldet', 401));
    await syncNow();
    expect(status()).toMatchObject({ state: 'auth', message: 'Nicht angemeldet' });

    request.mockRejectedValueOnce(new ProtoError('Diese App-Version ist zu alt für den Server. Bitte die App aktualisieren.', 426));
    await syncNow();
    expect(status()).toMatchObject({ state: 'error', message: expect.stringContaining('App aktualisieren') });

    request.mockRejectedValueOnce(new Error('unerwartet'));
    await syncNow();
    expect(status()).toMatchObject({ state: 'error', message: 'Abgleich fehlgeschlagen.' });
  });

  it('meldet Konflikte und Ablehnungen im Text, ohne dass die Daten verloren gehen', async () => {
    const p = { ...newProtokoll(), title: 'Groß' };
    await db.protokolle.add(p);
    request.mockResolvedValue(reply({ rejected: [{ kind: 'protocol', id: p.id, reason: 'Protokoll zu groß' }] }));
    const res = await syncNow();
    expect(res).toMatchObject({ rejected: 1 });
    expect(status().message).toContain('1 Protokoll(e) vom Server abgelehnt');
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 1, rejected: 'Protokoll zu groß' });
  });

  it('der Hinweis auf vom Server abgelehnte Anhänge bleibt über die Läufe stehen, ohne dass sie erneut versucht werden', async () => {
    await putLocalBlob({ id: 'foto-gross1', kind: 'photo', mime: 'image/jpeg', name: '', data: Uint8Array.from([0xff, 0xd8, 0xff, 1]) });
    await db.blobs.update('foto-gross1', { rejected: 'Payload Too Large' });
    const p = { ...newProtokoll(), content: { type: 'doc', content: [{ type: 'photo', attrs: { blobId: 'foto-gross1' } }] } };
    await db.protokolle.add(p);
    request.mockResolvedValue(reply());
    await syncNow();
    expect(status().message).toContain('1 Anhang/Anhänge vom Server abgelehnt');
    await syncNow();
    expect(status().message).toContain('1 Anhang/Anhänge vom Server abgelehnt');
    expect(request.mock.calls.filter((c) => c[1] === 'PUT')).toEqual([]);
    expect(status().state).toBe('idle');

    // Wird das Foto aus dem Protokoll entfernt, ist nichts mehr zu melden.
    await db.protokolle.update(p.id, { content: { type: 'doc', content: [{ type: 'paragraph' }] } });
    await syncNow();
    expect(status().message).not.toContain('Anhang');
  });

  it('ein Server mit zu alter Schnittstelle wird als Fehler gemeldet', async () => {
    request.mockResolvedValue(reply({ api: 0 }));
    await syncNow();
    expect(status()).toMatchObject({ state: 'error', message: expect.stringContaining('Server aktualisieren') });
  });
});
