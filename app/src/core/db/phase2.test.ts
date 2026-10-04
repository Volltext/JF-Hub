import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { memberRepo, sessionRepo } from './repos';
import { attendanceStats } from '@/core/domain/stats';

beforeEach(async () => {
  await Promise.all([db.members.clear(), db.sessions.clear(), db.tasks.clear(), db.kv.clear()]);
});

describe('sessionRepo', () => {
  it('markiert aktive Nicht-Anwesende als abwesend und überschreibt je Datum', async () => {
    const a = await memberRepo.add('Anna', 'jugendlich');
    const b = await memberRepo.add('Ben', 'jugendlich');
    const c = await memberRepo.add('Cora', 'betreuer');
    await memberRepo.update(c.id, { active: false });

    const first = await sessionRepo.save('2026-10-05', [a.id]);
    expect(first.absent).toEqual([b.id]);

    const second = await sessionRepo.save('2026-10-05', [a.id, b.id]);
    expect(second.id).toBe(first.id);
    expect(await db.sessions.count()).toBe(1);
    expect(second.absent).toEqual([]);
  });

  it('lehnt leere Namen ab', async () => {
    await expect(memberRepo.add('  ', 'jugendlich')).rejects.toThrow();
  });
});

describe('attendanceStats', () => {
  it('zählt nur erfasste Dienste', () => {
    const m = { id: 'a', name: 'A', kind: 'jugendlich' as const, active: true };
    const s = (present: string[], absent: string[]) => ({ id: Math.random() + '', date: 'd', present, absent, savedAt: '' });
    const [st] = attendanceStats([m], [s(['a'], []), s([], ['a']), s([], [])]);
    expect(st).toMatchObject({ present: 1, total: 2, rate: 0.5 });
  });

  it('liefert rate=null ohne Daten', () => {
    const m = { id: 'a', name: 'A', kind: 'jugendlich' as const, active: true };
    expect(attendanceStats([m], [])[0]!.rate).toBeNull();
  });
});
