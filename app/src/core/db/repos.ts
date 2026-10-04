import { db } from './db';
import { markChanged } from './outbox';
import { newId, nowIso } from '@/core/domain/id';
import { loadAccount } from '@/core/account/account';
import { loadSettings } from '@/core/settings/settings';
import type { ID, Member, MemberKind, Priority, Session, Task } from '@/core/domain/types';

export const memberRepo = {
  async add(name: string, kind: MemberKind): Promise<Member> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name fehlt.');
    const m: Member = { id: newId(), name: trimmed, kind, active: true };
    await db.members.add(m);
    await markChanged('members', m.id);
    return m;
  },
  async update(id: ID, patch: Partial<Omit<Member, 'id'>>): Promise<void> {
    if (patch.name !== undefined && !patch.name.trim()) throw new Error('Name fehlt.');
    await db.members.update(id, patch.name ? { ...patch, name: patch.name.trim() } : patch);
    await markChanged('members', id);
  },
  /** Löscht das Mitglied samt Kleidergrößen. Frühere Dienste behalten die ID, die Statistik ignoriert sie. */
  async remove(id: ID): Promise<void> {
    await db.members.delete(id);
    await markChanged('members', id, true);
    if (await db.clothing.get(id)) {
      await db.clothing.delete(id);
      await markChanged('clothing', id, true);
    }
  },
};

export const sessionRepo = {
  /**
   * Speichert die Anwesenheit für ein Datum. Ein vorhandener Eintrag desselben Tages
   * wird überschrieben. Alle aktiven Mitglieder, die nicht anwesend sind, gelten als abwesend.
   */
  async save(date: string, present: ID[]): Promise<Session> {
    const active = (await db.members.toArray()).filter((m) => m.active).map((m) => m.id);
    const presentSet = new Set(present);
    const existing = await db.sessions.where('date').equals(date).first();
    const session: Session = {
      id: existing?.id ?? newId(),
      date,
      present: [...presentSet],
      absent: active.filter((id) => !presentSet.has(id)),
      savedAt: nowIso(),
    };
    await db.sessions.put(session);
    await markChanged('sessions', session.id);
    return session;
  },
  async remove(id: ID): Promise<void> {
    await db.sessions.delete(id);
    await markChanged('sessions', id, true);
  },
};

export interface TaskInput {
  title: string;
  description: string;
  dueDate: string | null;
  priority: Priority;
  sessionId: ID | null;
  /** Für alle Betreuer sichtbar? Fehlt = Standard aus den Einstellungen (nur bei neuen Aufgaben). */
  shared?: boolean;
}

export const taskRepo = {
  async add(input: TaskInput): Promise<Task> {
    const title = input.title.trim();
    if (!title) throw new Error('Titel fehlt.');
    const t: Task = {
      ...input,
      shared: input.shared ?? (await loadSettings()).defaultShared,
      title,
      id: newId(),
      completed: false,
      createdAt: nowIso(),
      completedAt: null,
    };
    await db.tasks.add(t);
    await markChanged('tasks', t.id);
    return t;
  },
  async update(id: ID, input: TaskInput): Promise<void> {
    const title = input.title.trim();
    if (!title) throw new Error('Titel fehlt.');
    await db.tasks.update(id, { ...input, title });
    await markChanged('tasks', id);
  },
  async setCompleted(id: ID, completed: boolean): Promise<void> {
    const me = await loadAccount();
    await db.tasks.update(id, { completed, completedAt: completed ? nowIso() : null, completedBy: completed ? me?.id : undefined });
    await markChanged('tasks', id);
  },
  async remove(id: ID): Promise<void> {
    await db.tasks.delete(id);
    await markChanged('tasks', id, true);
  },
};
