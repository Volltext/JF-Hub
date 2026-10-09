import { describe, expect, it } from 'vitest';
import { db } from '@/core/db/db';
import { loadAccount } from '@/core/account/account';
import { memberRepo } from '@/core/db/repos';
import { DEFAULT_ITEMS } from '@/features/kleidung/model';
import { schemaAccepts } from '@/features/protokolle/editorSchema';
import { DEMO_ACCOUNT, isDemoSeeded, seedDemo } from './seed';

describe('Browser-Demo', () => {
  it('legt die Beispieldaten aus Janas Sicht an', async () => {
    await seedDemo(new Date(2026, 9, 6, 10, 0));
    expect(await isDemoSeeded()).toBe(true);
    expect(await loadAccount()).toEqual(DEMO_ACCOUNT);

    expect(await db.members.count()).toBeGreaterThan(10);
    expect(await db.sessions.count()).toBe(10);
    expect(await db.runs.count()).toBeGreaterThan(5);
    expect(await db.lineupTemplates.count()).toBe(2);
    expect((await db.clothingItems.toArray()).sort((a, b) => a.order - b.order)).toEqual(DEFAULT_ITEMS);
    expect(await db.folders.count()).toBe(3);

    // Privates von Tobias gibt es hier nicht, Janas eigenes schon.
    const titles = (await db.protokolle.toArray()).map((p) => p.title);
    expect(titles).toContain('Notizen Jahresplanung (privat)');
    expect(titles).not.toContain('Ideen Spieleabend (privat)');
    const tasks = await db.tasks.toArray();
    expect(tasks.map((t) => t.title)).toContain('Dienstplan fürs nächste Halbjahr entwerfen');
    expect(tasks.some((t) => t.ownerId !== DEMO_ACCOUNT.id && !t.shared)).toBe(false);

    // Nichts ist zum Senden vorgemerkt: Es gibt keinen Server.
    expect(await db.protokolle.where('dirty').equals(1).count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);

    // Der letzte Dienst lag am Montag davor.
    const last = (await db.sessions.orderBy('date').last())!;
    expect(last.date).toBe('2026-10-05');
  });

  it('die Beispielprotokolle zeigen Tabelle, Link und Hervorhebung und sind für den Editor lesbar', async () => {
    await seedDemo(new Date(2026, 9, 6));
    const docs = await db.protokolle.toArray();
    const json = JSON.stringify(docs.map((p) => p.content));
    for (const part of ['"type":"table"', '"type":"tableHeader"', '"type":"tableCell"', '"type":"link"', '"type":"highlight"']) expect(json, part).toContain(part);
    for (const p of docs) expect(schemaAccepts(p.content), p.title).toBe(true);
  });

  it('Zurücksetzen entfernt eigene Änderungen und datiert neu', async () => {
    await seedDemo(new Date(2026, 9, 6));
    await memberRepo.add('Besucher Test', 'jugendlich');
    expect((await db.members.toArray()).some((m) => m.name === 'Besucher Test')).toBe(true);

    await seedDemo(new Date(2026, 9, 20));
    expect((await db.members.toArray()).some((m) => m.name === 'Besucher Test')).toBe(false);
    expect((await db.sessions.orderBy('date').last())!.date).toBe('2026-10-19');
  });
});
