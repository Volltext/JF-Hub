import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/core/db/db';
import { todayIso } from '@/core/domain/id';
import { clothingCounts } from './counts';

export interface Attention {
  openTasks: number;
  overdueTasks: number;
  clothing: number;
  members: number;
}

/** Zahlen für Hinweise an Bereichen, die unter „Mehr“ liegen (Zähler in der Liste, Punkt an der unteren Leiste). */
export function useAttention(): Attention {
  const today = todayIso();
  return (
    useLiveQuery(async () => {
      const open = await db.tasks.filter((t) => !t.completed).toArray();
      return {
        openTasks: open.length,
        overdueTasks: open.filter((t) => t.dueDate && t.dueDate < today).length,
        clothing: (await clothingCounts()).open,
        members: await db.members.filter((m) => m.active).count(),
      };
    }, [today]) ?? { openTasks: 0, overdueTasks: 0, clothing: 0, members: 0 }
  );
}
