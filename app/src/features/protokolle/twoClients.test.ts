import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { putLocalBlob } from '@/core/db/blobs';
import { HubDb } from '@/core/db/db';
import { bytesToBase64 } from '@/core/domain/base64';
import { BlobError, checkUpload, findBlob, readBlobData, storeBlob } from '../../../../server/src/blobs';
import { openDb } from '../../../../server/src/db';
import { applySync, type SyncRequest as ServerRequest, type SyncUser } from '../../../../server/src/sync';
import { ensureBlob, type BlobTransport } from './blobSync';
import { ProtoError } from './http';
import { newProtokoll } from './model';
import { MIN_SERVER_API } from './schemaVersion';
import { performSync, type SyncResponse } from './sync';

/**
 * Zwei Geräte gleichen sich gegen den echten Server-Code ab (`applySync` mit einer Datenbank im Speicher).
 * So stehen Client- und Server-Regeln für Konflikte in einem Test zusammen.
 */
const ANNA: SyncUser = { id: 'user-anna', role: 'betreuer' };
const BEN: SyncUser = { id: 'user-ben', role: 'betreuer' };

let server: DatabaseSync;
let anna: HubDb;
let ben: HubDb;
let n = 0;
let clock = 1_000;

beforeEach(() => {
  server = openDb(':memory:');
  n++;
  anna = new HubDb(`test-anna-${n}`);
  ben = new HubDb(`test-ben-${n}`);
});
afterEach(async () => {
  await anna.delete();
  await ben.delete();
});

const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Anhänge über dieselben Regeln wie der echte Server (Prüfung beim Hochladen, Zugriff beim Abruf). */
function blobsOf(user: SyncUser): BlobTransport {
  return {
    upload: async (meta, data) => {
      try {
        const upload = checkUpload({ id: meta.id, kind: meta.kind, name: meta.name, mime: meta.mime, data: bytesToBase64(data) });
        storeBlob(server, { id: meta.id, ...upload, uploaderId: user.id });
      } catch (e) {
        if (e instanceof BlobError) throw new ProtoError(e.message, e.status);
        throw e;
      }
    },
    download: async (id) => {
      if (!findBlob(server, id, user.id)) throw new ProtoError('Nicht gefunden', 404);
      return new Uint8Array(readBlobData(server, id)!);
    },
  };
}

/** Ein Abgleich eines Geräts. `during` läuft, während die Anfrage unterwegs ist (der Nutzer tippt weiter). */
function syncOf(store: HubDb, user: SyncUser, during?: () => Promise<void>) {
  return performSync(
    async (req) => {
      const res = applySync(server, wire(req) as unknown as ServerRequest, user);
      await during?.();
      return { ...wire(res), api: MIN_SERVER_API } as unknown as SyncResponse;
    },
    {},
    store,
    blobsOf(user),
  );
}

const edit = async (store: HubDb, id: string, title: string): Promise<void> => {
  await store.protokolle.update(id, { title, updatedAt: ++clock, dirty: 1 });
};
const copies = () => (server.prepare("SELECT COUNT(*) AS n FROM protocols WHERE title LIKE '% (Konflikt)'").get() as { n: number }).n;

async function sharedDoc(): Promise<string> {
  const doc = { ...newProtokoll('', true), title: 'Sitzung' };
  await anna.protokolle.add(doc);
  await syncOf(anna, ANNA);
  await syncOf(ben, BEN);
  expect((await ben.protokolle.get(doc.id))?.title).toBe('Sitzung');
  return doc.id;
}

describe('zwei Geräte, ein veröffentlichtes Protokoll', () => {
  it('gleichzeitiges Bearbeiten ergibt genau eine Kopie und geht nichts verloren', async () => {
    const id = await sharedDoc();
    await edit(anna, id, 'Anna: Anfang');
    await edit(ben, id, 'Ben: Anfang');
    await syncOf(ben, BEN); // Ben ist zuerst beim Server
    await syncOf(anna, ANNA);
    expect(copies()).toBe(1);
    expect(await anna.protokolle.get(id)).toMatchObject({ title: 'Ben: Anfang', dirty: 0 });
    expect(server.prepare("SELECT title FROM protocols WHERE title LIKE '% (Konflikt)'").get()).toMatchObject({ title: 'Anna: Anfang (Konflikt)' });
  });

  it('weiteres Tippen während des Abgleichs erzeugt keine weiteren Kopien', async () => {
    const id = await sharedDoc();
    await edit(anna, id, 'Anna: Anfang');
    await edit(ben, id, 'Ben: Anfang');
    await syncOf(ben, BEN);

    // Anna tippt bei jedem Abgleich weiter; ihre Fassung des Servers bleibt dabei veraltet.
    for (let i = 0; i < 4; i++) await syncOf(anna, ANNA, () => edit(anna, id, `Anna: Stand ${i}`));
    expect(copies()).toBe(1);
    expect(await anna.protokolle.get(id)).toMatchObject({ title: 'Anna: Stand 3', dirty: 1 }); // die Arbeit am Gerät bleibt erhalten

    // Sobald Anna aufhört, übernimmt ihr Gerät die Fassung des Servers; ihre Arbeit liegt in der einen Kopie.
    await syncOf(anna, ANNA);
    expect(copies()).toBe(1);
    expect(await anna.protokolle.get(id)).toMatchObject({ title: 'Ben: Anfang', dirty: 0 });
    expect(server.prepare("SELECT title FROM protocols WHERE title LIKE '% (Konflikt)'").get()).toMatchObject({ title: 'Anna: Stand 3 (Konflikt)' });
    await syncOf(anna, ANNA);
    expect(copies()).toBe(1);
  });

  it('eine verlorene Antwort führt bei der Wiederholung nicht zu einer Kopie', async () => {
    const doc = { ...newProtokoll('', true), title: 'Sitzung' };
    await anna.protokolle.add(doc);
    await expect(
      performSync(
        async (req) => {
          applySync(server, wire(req) as unknown as ServerRequest, ANNA); // der Server hat gespeichert …
          throw new Error('Antwort verloren'); // … die Antwort kommt nicht an
        },
        {},
        anna,
      ),
    ).rejects.toThrow();
    expect(await anna.protokolle.get(doc.id)).toMatchObject({ dirty: 1, rev: 0 });

    await syncOf(anna, ANNA);
    expect(copies()).toBe(0);
    const stored = await anna.protokolle.get(doc.id);
    expect(stored).toMatchObject({ dirty: 0 });
    expect(stored!.rev).toBeGreaterThan(0);
  });

  it('dieselbe Änderung auf einem veralteten Stand wird nicht zur Kopie, wenn der Inhalt schon beim Server liegt', async () => {
    const id = await sharedDoc();
    await edit(anna, id, 'Gleicher Titel');
    await edit(ben, id, 'Gleicher Titel');
    await syncOf(ben, BEN);
    await syncOf(anna, ANNA);
    expect(copies()).toBe(0);
    expect(await anna.protokolle.get(id)).toMatchObject({ title: 'Gleicher Titel', dirty: 0 });
  });
});

describe('Fotos zwischen zwei Geräten', () => {
  const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6]);
  const photoDoc = (blobId: string, shared: boolean) => ({
    ...newProtokoll('', shared),
    title: 'Mit Foto',
    content: { type: 'doc', content: [{ type: 'paragraph' }, { type: 'photo', attrs: { blobId, mime: 'image/jpeg', w: 8, h: 6, caption: 'Teich' } }] },
  });
  const info = { id: 'foto-0001', kind: 'photo' as const, mime: 'image/jpeg', name: '' };
  const addPhoto = (store: HubDb) => putLocalBlob({ id: 'foto-0001', kind: 'photo', mime: 'image/jpeg', name: '', data: JPEG }, store);

  it('ein veröffentlichtes Foto kommt bei Ben an, sobald er es anschaut', async () => {
    await addPhoto(anna);
    await anna.protokolle.add(photoDoc('foto-0001', true));
    await syncOf(anna, ANNA);
    expect(await anna.blobs.get('foto-0001')).toMatchObject({ state: 'synced' });

    await syncOf(ben, BEN);
    expect(await ben.protokolle.count()).toBe(1);
    expect(await ben.blobs.count()).toBe(0); // geladen wird erst beim Anschauen
    const got = await ensureBlob(info, blobsOf(BEN), ben);
    expect(Array.from(got.data)).toEqual(Array.from(JPEG));
    expect(await ben.blobs.get('foto-0001')).toMatchObject({ state: 'synced' });
  });

  it('ein privates Foto bekommt niemand sonst', async () => {
    await addPhoto(anna);
    await anna.protokolle.add(photoDoc('foto-0001', false));
    await syncOf(anna, ANNA);
    await expect(ensureBlob(info, blobsOf(BEN), ben)).rejects.toMatchObject({ reason: 'missing' });
  });

  it('zieht Anna das Protokoll zurück, ist das Foto für Ben weg, für sie nicht', async () => {
    await addPhoto(anna);
    const doc = photoDoc('foto-0001', true);
    await anna.protokolle.add(doc);
    await syncOf(anna, ANNA);
    await anna.protokolle.update(doc.id, { shared: false, updatedAt: ++clock, dirty: 1 });
    await syncOf(anna, ANNA);
    await expect(ensureBlob(info, blobsOf(BEN), ben)).rejects.toMatchObject({ reason: 'missing' });
    expect(Array.from((await ensureBlob(info, blobsOf(ANNA), anna)).data)).toEqual(Array.from(JPEG));
  });

  it('wird die Server-Datenbank ersetzt, lädt das Gerät das Foto mit dem Protokoll erneut hoch', async () => {
    await addPhoto(anna);
    await anna.protokolle.add(photoDoc('foto-0001', true));
    await syncOf(anna, ANNA);
    server = openDb(':memory:'); // zum Beispiel eine ältere Sicherung eingespielt: das Foto ist weg

    await syncOf(anna, ANNA); // erkennt die neue Datenbank, merkt das Protokoll zum erneuten Senden vor
    await syncOf(anna, ANNA); // sendet es; der Server meldet das fehlende Foto
    expect(findBlob(server, 'foto-0001', ANNA.id)).toBeUndefined();
    await syncOf(anna, ANNA); // lädt es hoch
    expect(findBlob(server, 'foto-0001', ANNA.id)).toBeDefined();
    expect((await anna.blobs.get('foto-0001'))!.state).toBe('synced');
  });

  it('ein Server, der das Foto ablehnt, lässt den Rest des Abgleichs durch', async () => {
    await putLocalBlob({ id: 'kein-jpeg-1', kind: 'photo', mime: 'image/jpeg', name: '', data: Uint8Array.from([1, 2, 3, 4, 5]) }, anna);
    await anna.protokolle.add(photoDoc('kein-jpeg-1', true));
    const res = await syncOf(anna, ANNA);
    expect(res.blobs).toEqual({ uploaded: 0, rejected: 1, failed: 0 });
    expect(await anna.protokolle.where('dirty').equals(1).count()).toBe(0);
    expect(await anna.blobs.get('kein-jpeg-1')).toMatchObject({ state: 'local' });
    expect((await anna.blobs.get('kein-jpeg-1'))!.rejected).toContain('JPEG');
  });
});
