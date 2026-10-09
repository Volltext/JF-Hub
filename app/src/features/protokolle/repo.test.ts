import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/core/db/db';
import { saveSettings } from '@/core/settings/settings';
import { newProtokoll } from './model';

// Der Abgleich selbst ist in sync.test.ts abgedeckt; hier zählt nur, ob er angestoßen wird.
vi.mock('./sync', () => ({ scheduleSync: vi.fn(), syncNow: vi.fn(async () => null) }));
import { scheduleSync } from './sync';
import { protokolleRepo } from './repo';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([db.protokolle.clear(), db.ydocs.clear(), db.kv.clear()]);
});

describe('protokolleRepo.save', () => {
  async function stored(over: Record<string, unknown> = {}) {
    const p = { ...newProtokoll(), title: 'Sitzung', content: doc('Hallo'), dirty: 0 as const, rev: 3, updatedAt: 111, ...over };
    await db.protokolle.add(p);
    return p;
  }

  it('schreibt nichts und plant keinen Abgleich, wenn sich nichts ändert', async () => {
    const p = await stored();
    const at = await protokolleRepo.save(p.id, { title: 'Sitzung', datum: p.datum });
    expect(at).toBe(111);
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 0, updatedAt: 111, rev: 3 });
    expect(scheduleSync).not.toHaveBeenCalled();
  });

  it('behandelt einen fehlenden Ordner wie die oberste Ebene und fehlendes shared wie privat', async () => {
    const p = await stored({ folderId: undefined, shared: undefined });
    await protokolleRepo.save(p.id, { folderId: '', shared: false });
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 0, updatedAt: 111 });
    expect(scheduleSync).not.toHaveBeenCalled();
  });

  it('markiert echte Änderungen als ungesendet, setzt die Änderungszeit und plant den Abgleich', async () => {
    const p = await stored();
    const at = await protokolleRepo.save(p.id, { title: 'Neuer Titel' });
    expect(at).toBeGreaterThan(111);
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 1, updatedAt: at, title: 'Neuer Titel' });
    expect(scheduleSync).toHaveBeenCalledTimes(1);
  });

  it('der Text gehört nicht in den Patch: Er wird zusammen bearbeitet und nie über die Kopfdaten gespeichert', async () => {
    const p = await stored();
    await protokolleRepo.save(p.id, { title: 'Sitzung', content: doc('Fremd') } as never);
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 0, content: doc('Hallo'), updatedAt: 111 });
    expect(scheduleSync).not.toHaveBeenCalled();
  });

  it('eine einzige geänderte Angabe genügt, und nur sie bekommt eine neue Änderungszeit', async () => {
    const p = await stored({ metaAt: { title: 50, datum: 60, ort: 70, beginn: 80, ende: 90, leitung: 95, folderId: 96, shared: 97 } });
    const at = await protokolleRepo.save(p.id, { title: 'Sitzung', ort: 'Gerätehaus' });
    const row = (await db.protokolle.get(p.id))!;
    expect(row).toMatchObject({ dirty: 1, ort: 'Gerätehaus' });
    expect(row.metaAt).toEqual({ title: 50, datum: 60, ort: at, beginn: 80, ende: 90, leitung: 95, folderId: 96, shared: 97 });
  });

  it('zwei Änderungen desselben Feldes in derselben Millisekunde bekommen verschiedene Zeiten (sonst ginge die zweite unter)', async () => {
    const p = await stored({ metaAt: { title: 5_000_000_000_000 } }); // eine Zeit in der Zukunft: jetzt ist nicht größer
    await protokolleRepo.save(p.id, { title: 'A' });
    await protokolleRepo.save(p.id, { title: 'B' });
    expect((await db.protokolle.get(p.id))!.metaAt!.title).toBe(5_000_000_000_002);
  });

  it('Felder ohne eigene Zeit (Zeile aus der Zeit vor 3.0.0) gelten als zur Änderungszeit der Zeile geändert, nicht als eben jetzt', async () => {
    const p = await stored({ metaAt: undefined });
    const at = await protokolleRepo.save(p.id, { ort: 'Neu' });
    const times = (await db.protokolle.get(p.id))!.metaAt!;
    expect(times.ort).toBe(at);
    expect(times.title).toBe(111);
    expect(times.datum).toBe(111);
  });

  it('Sichtbarkeit und Ordner wechseln zählen als Änderung', async () => {
    const p = await stored();
    await protokolleRepo.save(p.id, { shared: true });
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 1, shared: true });
    await protokolleRepo.save(p.id, { folderId: 'ordner-1' });
    expect(await db.protokolle.get(p.id)).toMatchObject({ folderId: 'ordner-1' });
  });

  it('eine Änderung räumt die frühere Ablehnung durch den Server ab', async () => {
    const p = await stored({ dirty: 1, rejected: 'Protokoll zu groß' });
    await protokolleRepo.save(p.id, { title: 'Kleiner' });
    const row = await db.protokolle.get(p.id);
    expect(row).toMatchObject({ dirty: 1, title: 'Kleiner' });
    expect(row?.rejected).toBeUndefined();
  });

  it('ohne Änderung bleibt die Ablehnung stehen', async () => {
    const p = await stored({ dirty: 1, rejected: 'Protokoll zu groß' });
    await protokolleRepo.save(p.id, { title: 'Sitzung' });
    expect((await db.protokolle.get(p.id))?.rejected).toBe('Protokoll zu groß');
  });

  it('ein verschwundenes Protokoll legt nichts neu an', async () => {
    await protokolleRepo.save('gibt-es-nicht', { title: 'x' });
    expect(await db.protokolle.count()).toBe(0);
  });
});

describe('protokolleRepo.create und remove', () => {
  it('übernimmt die Standard-Sichtbarkeit aus den Einstellungen', async () => {
    expect((await protokolleRepo.create('')).shared).toBe(false);
    await saveSettings({ defaultShared: true });
    expect((await protokolleRepo.create('ordner-1'))).toMatchObject({ shared: true, folderId: 'ordner-1' });
  });

  it('löscht nie gesendete Protokolle sofort, andere merkt es für den Abgleich vor', async () => {
    const fresh = await protokolleRepo.create('');
    await protokolleRepo.remove(fresh.id);
    expect(await db.protokolle.get(fresh.id)).toBeUndefined();

    const sent = { ...newProtokoll(), rev: 4, dirty: 0 as const };
    await db.protokolle.add(sent);
    await protokolleRepo.remove(sent.id);
    expect(await db.protokolle.get(sent.id)).toMatchObject({ deleted: 1, dirty: 1 });
    expect(scheduleSync).toHaveBeenCalledWith(300);
  });

  it('ein nie gesendetes Protokoll nimmt seinen Text mit', async () => {
    const fresh = await protokolleRepo.create('');
    await db.ydocs.put({ id: fresh.id, update: new Uint8Array([0, 0]), dirty: 1, seq: 1 });
    await protokolleRepo.remove(fresh.id);
    expect(await db.ydocs.get(fresh.id)).toBeUndefined();
  });
});
