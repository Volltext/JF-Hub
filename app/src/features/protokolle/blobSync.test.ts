import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HubDb } from '@/core/db/db';
import { markSynced, putLocalBlob, readBlob } from '@/core/db/blobs';
import { BlobUnavailable, ensureBlob, uploadPendingBlobs, type BlobTransport } from './blobSync';
import { ProtoError } from './http';

let store: HubDb;
let n = 0;
beforeEach(() => {
  n++;
  store = new HubDb(`blobsync-test-${n}`);
});
afterEach(async () => {
  await store.delete();
});

const bytes = (size: number, fill = 7) => new Uint8Array(size).fill(fill);
const local = (id: string, size = 5) => putLocalBlob({ id, kind: 'photo', mime: 'image/jpeg', name: '', data: bytes(size) }, store);
const info = (id: string) => ({ id, kind: 'photo' as const, mime: 'image/jpeg', name: '' });

function transport(over: Partial<BlobTransport> = {}) {
  const uploaded: string[] = [];
  const downloads: string[] = [];
  const t: BlobTransport = {
    upload: async (meta) => void uploaded.push(meta.id),
    download: async (id) => {
      downloads.push(id);
      return bytes(4, 9);
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

  it('keine Verbindung, ungültige Anmeldung oder zu viele Anfragen stoppen den Lauf; die Anhänge bleiben wartend', async () => {
    await local('anh-000001');
    await local('anh-000002');
    for (const status of [0, 401, 408, 429]) {
      const { t } = transport({ upload: async () => Promise.reject(new ProtoError('Fehler', status)) });
      await expect(uploadPendingBlobs(t, store)).rejects.toMatchObject({ status });
      expect(await store.blobs.where('state').equals('local').count()).toBe(2);
      expect(await store.blobs.get('anh-000001')).not.toHaveProperty('rejected');
    }
  });

  it('ein Serverfehler bei einem Anhang hält die übrigen nicht auf; er kommt beim nächsten Mal wieder dran', async () => {
    await local('anh-kaputt01');
    await local('anh-gut-001');
    let broken = true;
    const { t, uploaded } = transport({
      upload: async (meta) => {
        if (meta.id === 'anh-kaputt01' && broken) throw new ProtoError('Serverfehler 500.', 500);
        uploaded.push(meta.id);
      },
    });
    expect(await uploadPendingBlobs(t, store)).toEqual({ uploaded: 1, rejected: 0, failed: 1 });
    expect(await store.blobs.get('anh-kaputt01')).toMatchObject({ state: 'local' });
    expect(await store.blobs.get('anh-kaputt01')).not.toHaveProperty('rejected');
    broken = false;
    expect(await uploadPendingBlobs(t, store)).toEqual({ uploaded: 1, rejected: 0, failed: 0 });
    expect(uploaded).toEqual(['anh-gut-001', 'anh-kaputt01']);
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
    expect(Array.from(got.data)).toEqual([9, 9, 9, 9]);
    expect(await store.blobs.get('fremd-0001')).toMatchObject({ state: 'synced', kind: 'file', name: 'Plan.pdf', mime: 'application/pdf', size: 4 });
    await ensureBlob({ id: 'fremd-0001', kind: 'file', mime: 'application/pdf', name: 'Plan.pdf' }, t, store);
    expect(downloads).toEqual(['fremd-0001']);
  });

  it('mehrere gleichzeitige Anfragen nach demselben Anhang laden ihn nur einmal', async () => {
    let release: () => void = () => {};
    const { t, downloads } = transport({
      download: (id) => {
        downloads.push(id);
        return new Promise<Uint8Array>((resolve) => (release = () => resolve(bytes(4))));
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

  it('hochgeladene Anhänge bleiben als Kopie lesbar', async () => {
    await local('anh-000001', 6);
    await markSynced('anh-000001', store);
    expect((await readBlob('anh-000001', store))!.data.length).toBe(6);
  });
});
