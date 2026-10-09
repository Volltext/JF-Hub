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
  await Promise.all([db.protokolle.clear(), db.kv.clear()]);
});

describe('protokolleRepo.save', () => {
  async function stored(over: Record<string, unknown> = {}) {
    const p = { ...newProtokoll(), title: 'Sitzung', content: doc('Hallo'), dirty: 0 as const, rev: 3, updatedAt: 111, ...over };
    await db.protokolle.add(p);
    return p;
  }

  it('schreibt nichts und plant keinen Abgleich, wenn sich nichts ändert', async () => {
    const p = await stored();
    const at = await protokolleRepo.save(p.id, { title: 'Sitzung', datum: p.datum, content: doc('Hallo') });
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
    const at = await protokolleRepo.save(p.id, { title: 'Sitzung', content: doc('Hallo Welt') });
    expect(at).toBeGreaterThan(111);
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 1, updatedAt: at, content: doc('Hallo Welt') });
    expect(scheduleSync).toHaveBeenCalledTimes(1);
  });

  it('eine einzige geänderte Angabe genügt', async () => {
    const p = await stored();
    await protokolleRepo.save(p.id, { title: 'Sitzung', ort: 'Gerätehaus', content: doc('Hallo') });
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 1, ort: 'Gerätehaus' });
  });

  it('Sichtbarkeit und Ordner wechseln zählen als Änderung', async () => {
    const p = await stored();
    await protokolleRepo.save(p.id, { shared: true });
    expect(await db.protokolle.get(p.id)).toMatchObject({ dirty: 1, shared: true });
    await protokolleRepo.save(p.id, { folderId: 'ordner-1' });
    expect(await db.protokolle.get(p.id)).toMatchObject({ folderId: 'ordner-1' });
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
});
