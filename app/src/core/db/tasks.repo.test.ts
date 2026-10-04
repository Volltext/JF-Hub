import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { taskRepo } from './repos';

const input = { title: ' Material ', description: '', dueDate: '2026-10-10', priority: 'high' as const, sessionId: null };

beforeEach(async () => {
  await db.tasks.clear();
});

describe('taskRepo', () => {
  it('trimmt Titel und lehnt leere ab', async () => {
    expect((await taskRepo.add(input)).title).toBe('Material');
    await expect(taskRepo.add({ ...input, title: ' ' })).rejects.toThrow();
  });

  it('setzt und löscht den Erledigt-Zeitstempel', async () => {
    const t = await taskRepo.add(input);
    await taskRepo.setCompleted(t.id, true);
    expect((await db.tasks.get(t.id))!.completedAt).not.toBeNull();
    await taskRepo.setCompleted(t.id, false);
    expect((await db.tasks.get(t.id))!.completedAt).toBeNull();
  });
});
