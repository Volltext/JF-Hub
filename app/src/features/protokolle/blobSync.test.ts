import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubDb } from '@/core/db/db';
import { markFailed, markRejected, markSynced, pendingBlobs, putLocalBlob, readBlob, rejectedBlobCount, retryBlobsNow, retryDelay } from '@/core/db/blobs';
import { BlobUnavailable, ensureBlob, uploadPendingBlobs, type BlobTransport } from './blobSync';
import { ProtoError } from './http';
import { newProtokoll } from './model';

let store: HubDb;
let n = 0;
beforeEach(() => {
  n++;
  store = new HubDb(`blobsync-test-${n}`);
});
afterEach(async () => {
  vi.useRealTimers();
  await store.delete();
});

const bytes = (size: number, fill = 7) => new Uint8Array(size).fill(fill);
/** Beginnt wie ein JPEG: So etwas nimmt die App als Foto an. */
const jpegLike = (...rest: number[]) => Uint8Array.from([0xff, 0xd8, 0xff, ...rest]);
const local = (id: string, size = 5) => putLocalBlob({ id, kind: 'photo', mime: 'image/jpeg', name: '', data: bytes(size) }, store);
const info = (id: string) => ({ id, kind: 'photo' as const, mime: 'image/jpeg', name: '' });

function transport(over: Partial<BlobTransport> = {}) {
  const uploaded: string[] = [];
  const downloads: string[] = [];
  const t: BlobTransport = {
    upload: async (meta) => void uploaded.push(meta.id),
    download: async (id) => {
      downloads.push(id);
      return jpegLike(9);
    },
    ...over,
  };
  return { t, uploaded, downloads };
}

describe('Anhänge hochladen', () => {
  it('lädt alle wartenden Anhänge hoch und merkt sie als hochgeladen', async () => {
    await local('anh-000001');
    await local('anh-000002');
    const { t, uploaded } = transport();
    expect(await uploadPendingBlobs(t, store)).toEqual({ uploaded: 2, rejected: 0, failed: 0 });
    expect(uploaded.sort()).toEqual(['anh-000001', 'anh-000002']);
    expect((await store.blobs.get('anh-000001'))!.state).toBe('synced');
    expect(await uploadPendingBlobs(t, store)).toEqual({ uploaded: 0, rejected: 0, failed: 0 }); // nichts mehr zu tun
    expect(uploaded).toHaveLength(2);
  });

  it('übersieht nichts, was mitten im Lauf dazukommt, und lädt nichts doppelt', async () => {
    await local('anh-000001');
    const { t, uploaded } = transport();
    await uploadPendingBlobs(t, store);
    await local('anh-000002');
    await uploadPendingBlobs(t, store);
    expect(uploaded).toEqual(['anh-000001', 'anh-000002']);
  });

  it('zwei gleichzeitige Läufe (Editor und Abgleich) laden denselben Anhang nicht doppelt hoch, und jeder kehrt erst zurück, wenn alles Wartende oben ist', async () => {
    await local('anh-gross01', 50);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const uploaded: string[] = [];
    const { t } = transport({
      upload: async (meta) => {
        uploaded.push(meta.id);
        await gate; // ein langsamer Upload
      },
    });
    const first = uploadPendingBlobs(t, store);
    await new Promise((r) => setTimeout(r, 10));
    await local('anh-000002'); // kommt dazu, während der erste Lauf noch hängt
    const second = uploadPendingBlobs(t, store);
    await new Promise((r) => setTimeout(r, 10));
    expect(uploaded).toEqual(['anh-gross01']); // der zweite Lauf wartet, statt denselben Anhang noch einmal zu senden
    release();
    await Promise.all([first, second]);
    expect(uploaded.sort()).toEqual(['anh-000002', 'anh-gross01']);
    expect((await store.blobs.get('anh-000002'))!.state).toBe('synced');
  });

  it('ein vom Server abgelehnter Anhang wird vermerkt und nicht erneut versucht; die übrigen gehen durch', async () => {
    await local('anh-gross01');
    await local('anh-gut-001');
    const { t, uploaded } = transport({
      upload: async (meta) => {
        if (meta.id === 'anh-gross01') throw new ProtoError('Das Foto ist größer als 6 MB', 413);
        uploaded.push(meta.id);
      },
    });
    expect(await uploadPendingBlobs(t, store)).toEqual({ uploaded: 1, rejected: 1, failed: 0 });
    expect(uploaded).toEqual(['anh-gut-001']);
    expect(await store.blobs.get('anh-gross01')).toMatchObject({ state: 'local', rejected: 'Das Foto ist größer als 6 MB' });
    expect(await uploadPendingBlobs(t, store)).toEqual({ uploaded: 0, rejected: 0, failed: 0 }); // kein neuer Versuch
  });

  it('offline, abgemeldet oder gedrosselt: der Lauf hört auf, wirft aber nicht, und die Anhänge bleiben ohne Pause wartend', async () => {
    await local('anh-000001');
    await local('anh-000002');
    for (const [status, timedOut] of [[0, false], [401, false], [429, false]] as const) {
      const attempts: string[] = [];
      const { t } = transport({
        upload: async (meta) => {
          attempts.push(meta.id);
          throw new ProtoError('Fehler', status, timedOut);
        },
      });
      expect(await uploadPendingBlobs(t, store)).toEqual({ uploaded: 0, rejected: 0, failed: 1 });
      expect(attempts).toHaveLength(1); // der zweite Versuch wäre zwecklos
      expect(await store.blobs.where('state').equals('local').count()).toBe(2);
      expect(await store.blobs.get('anh-000001')).not.toHaveProperty('retryAt'); // ohne Pause: Sobald es wieder geht, geht es weiter
    }
  });

  it('die Pause nach einem Fehlschlag rechnet ab dem Fehlschlag, nicht ab dem Aufruf: Ein Upload, der lange hängt, bevor er scheitert, bekommt trotzdem seine Pause', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    await local('anh-000002');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { t } = transport({
      upload: async () => {
        await gate; // hängt (schlechtes Netz) und scheitert dann
        throw new ProtoError('Zeitüberschreitung', 0, true);
      },
    });
    const run = uploadPendingBlobs(t, store);
    await new Promise((r) => setTimeout(r, 10));
    vi.setSystemTime(1_000_000 + 5 * 60_000); // der Upload hat fünf Minuten gebraucht
    release();
    expect(await run).toEqual({ uploaded: 0, rejected: 0, failed: 1 });
    expect((await store.blobs.get('anh-000002'))!.retryAt).toBe(1_000_000 + 5 * 60_000 + 60_000); // die Pause beginnt jetzt, nicht vor fünf Minuten
  });

  it('ein Zeitlimit oder Serverfehler lässt den Anhang mit wachsender Pause pausieren; die übrigen kommen dran', async () => {
    await local('anh-kaputt01', 50);
    await local('anh-gut-001', 5);
    let broken = true;
    const { t, uploaded } = transport({
      upload: async (meta) => {
        if (meta.id === 'anh-kaputt01' && broken) throw new ProtoError('Zeitüberschreitung', 0, true);
        uploaded.push(meta.id);
      },
    });
    const now = 1_000_000;
    expect(await uploadPendingBlobs(t, store, now)).toEqual({ uploaded: 1, rejected: 0, failed: 1 });
    expect(uploaded).toEqual(['anh-gut-001']); // die kleinen zuerst
    expect(await store.blobs.get('anh-kaputt01')).toMatchObject({ state: 'local', failures: 1, retryAt: now + 60_000 });
    expect(await store.blobs.get('anh-kaputt01')).not.toHaveProperty('rejected');

    // In der Pause wird nicht versucht, danach wieder, mit der nächsten längeren Pause.
    expect(await uploadPendingBlobs(t, store, now + 30_000)).toEqual({ uploaded: 0, rejected: 0, failed: 0 });
    expect(await uploadPendingBlobs(t, store, now + 61_000)).toEqual({ uploaded: 0, rejected: 0, failed: 1 });
    expect(await store.blobs.get('anh-kaputt01')).toMatchObject({ failures: 2, retryAt: now + 61_000 + 120_000 });

    broken = false;
    expect(await uploadPendingBlobs(t, store, now + 400_000)).toEqual({ uploaded: 1, rejected: 0, failed: 0 });
    expect(await store.blobs.get('anh-kaputt01')).toMatchObject({ state: 'synced' });
    expect(await store.blobs.get('anh-kaputt01')).not.toHaveProperty('retryAt');
    expect(await store.blobs.get('anh-kaputt01')).not.toHaveProperty('failures');
  });

  it('die Pause wächst bis höchstens eine Stunde', () => {
    expect([1, 2, 3, 4, 7, 20].map((n) => retryDelay(n) / 60_000)).toEqual([1, 2, 4, 8, 60, 60]);
  });

  it('ein Server, der diese App-Version nicht kennt (426), bekommt nichts: der Fehler geht nach oben', async () => {
    await local('anh-000001');
    const { t } = transport({ upload: async () => Promise.reject(new ProtoError('Der Server ist zu alt für diese App-Version. Bitte den Server aktualisieren.', 426)) });
    await expect(uploadPendingBlobs(t, store)).rejects.toMatchObject({ status: 426 });
    expect(await store.blobs.get('anh-000001')).toMatchObject({ state: 'local' });
  });

  it('„Alles neu abgleichen“ gibt abgelehnten und pausierten Anhängen einen neuen Versuch', async () => {
    await local('anh-000001');
    await local('anh-000002');
    await local('anh-000003');
    await store.protokolle.add({ ...newProtokoll(), content: { type: 'doc', content: [{ type: 'photo', attrs: { blobId: 'anh-000001' } }] } });
    await markRejected('anh-000001', 'zu groß', store);
    await markFailed('anh-000002', store);
    expect(await rejectedBlobCount(store)).toBe(1);
    expect(await pendingBlobs(store)).toHaveLength(1);
    expect(await retryBlobsNow(store)).toBe(2);
    expect(await rejectedBlobCount(store)).toBe(0);
    expect(await pendingBlobs(store)).toHaveLength(3);
  });

  it('ein Anhang ohne Bytes (beschädigt) wird übergangen statt den Abgleich zu blockieren', async () => {
    await local('anh-000001');
    await store.blobData.delete('anh-000001');
    const { t, uploaded } = transport();
    expect(await uploadPendingBlobs(t, store)).toEqual({ uploaded: 0, rejected: 0, failed: 0 });
    expect(uploaded).toEqual([]);
    expect(await store.blobs.get('anh-000001')).toBeUndefined();
  });
});

describe('Anhänge holen', () => {
  it('liefert lokale Anhänge ohne Netz', async () => {
    await local('anh-000001', 3);
    const { t, downloads } = transport();
    const got = await ensureBlob(info('anh-000001'), t, store);
    expect(got.data.length).toBe(3);
    expect(downloads).toEqual([]);
  });

  it('lädt Fehlendes vom Server, merkt es als Kopie und holt es danach nicht mehr', async () => {
    const { t, downloads } = transport();
    const got = await ensureBlob({ id: 'fremd-0001', kind: 'file', mime: 'application/pdf', name: 'Plan.pdf' }, t, store);
    expect(Array.from(got.data)).toEqual([0xff, 0xd8, 0xff, 9]);
    expect(await store.blobs.get('fremd-0001')).toMatchObject({ state: 'synced', kind: 'file', name: 'Plan.pdf', mime: 'application/pdf', size: 4 });
    await ensureBlob({ id: 'fremd-0001', kind: 'file', mime: 'application/pdf', name: 'Plan.pdf' }, t, store);
    expect(downloads).toEqual(['fremd-0001']);
  });

  it('mehrere gleichzeitige Anfragen nach demselben Anhang laden ihn nur einmal', async () => {
    let release: () => void = () => {};
    const { t, downloads } = transport({
      download: (id) => {
        downloads.push(id);
        return new Promise<Uint8Array>((resolve) => (release = () => resolve(jpegLike(1))));
      },
    });
    const first = ensureBlob(info('fremd-0001'), t, store);
    const second = ensureBlob(info('fremd-0001'), t, store);
    await new Promise((r) => setTimeout(r, 10));
    release();
    await Promise.all([first, second]);
    expect(downloads).toEqual(['fremd-0001']);
  });

  it('unterscheidet, warum es nicht geht: kein Netz, kein Server, nicht mehr vorhanden', async () => {
    const why = async (error: ProtoError) => {
      const { t } = transport({ download: () => Promise.reject(error) });
      return ensureBlob(info('fremd-0001'), t, store).catch((e: unknown) => e);
    };
    expect(await why(new ProtoError('Keine Verbindung zum Server.', 0))).toMatchObject({ reason: 'offline' });
    expect(await why(new ProtoError('Kein Server eingerichtet.', 0))).toMatchObject({ reason: 'no-server' });
    expect(await why(new ProtoError('Nicht gefunden', 404))).toMatchObject({ reason: 'missing' });
    expect(await why(new ProtoError('Serverfehler 500.', 500))).toMatchObject({ reason: 'error' });
    expect(await why(new ProtoError('Keine Verbindung zum Server.', 0))).toBeInstanceOf(BlobUnavailable);
    // Nach einem Fehler gibt es beim nächsten Versuch eine neue Anfrage.
    const ok = transport();
    expect((await ensureBlob(info('fremd-0001'), ok.t, store)).data.length).toBe(4);
  });

  it('speichert nichts, was kein Foto ist (zum Beispiel eine Fehlerseite eines Proxys), und fragt beim nächsten Mal erneut', async () => {
    const html = new TextEncoder().encode('<html>Bitte anmelden</html>');
    const bad = transport({ download: async () => html });
    await expect(ensureBlob(info('fremd-0001'), bad.t, store)).rejects.toMatchObject({ reason: 'error' });
    expect(await store.blobs.get('fremd-0001')).toBeUndefined();
    const good = transport();
    expect((await ensureBlob(info('fremd-0001'), good.t, store)).data.length).toBe(4);
  });

  it('bei Dateien zählt die Größe, die das Protokoll nennt', async () => {
    const short = transport({ download: async () => bytes(3) });
    await expect(ensureBlob({ id: 'datei-0001', kind: 'file', mime: 'application/pdf', name: 'a.pdf', size: 10 }, short.t, store)).rejects.toMatchObject({ reason: 'error' });
    const exact = transport({ download: async () => bytes(10) });
    expect((await ensureBlob({ id: 'datei-0001', kind: 'file', mime: 'application/pdf', name: 'a.pdf', size: 10 }, exact.t, store)).data.length).toBe(10);
    expect((await ensureBlob({ id: 'datei-0002', kind: 'file', mime: 'application/pdf', name: 'b.pdf' }, exact.t, store)).data.length).toBe(10); // ohne Angabe nur: nicht leer
    await expect(ensureBlob({ id: 'datei-0003', kind: 'file', mime: 'application/pdf', name: 'c.pdf' }, transport({ download: async () => new Uint8Array() }).t, store)).rejects.toMatchObject({ reason: 'error' });
  });

  it('ein Zeitlimit beim Laden gilt wie „offline“ (die Anzeige versucht es wieder, sobald Netz da ist)', async () => {
    const slow = transport({ download: () => Promise.reject(new ProtoError('Zeitüberschreitung', 0, true)) });
    await expect(ensureBlob(info('fremd-0001'), slow.t, store)).rejects.toMatchObject({ reason: 'offline' });
  });

  it('hochgeladene Anhänge bleiben als Kopie lesbar', async () => {
    await local('anh-000001', 6);
    await markSynced('anh-000001', store);
    expect((await readBlob('anh-000001', store))!.data.length).toBe(6);
  });
});
