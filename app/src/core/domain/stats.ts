import type { Member, Session } from './types';

export interface MemberStat {
  member: Member;
  present: number;
  /** Dienste, bei denen das Mitglied erfasst war (anwesend oder abwesend). */
  total: number;
  /** 0..1, null wenn noch keine Daten vorliegen. */
  rate: number | null;
}

export function attendanceStats(members: Member[], sessions: Session[]): MemberStat[] {
  return members.map((member) => {
    let present = 0;
    let total = 0;
    for (const s of sessions) {
      if (s.present.includes(member.id)) {
        present++;
        total++;
      } else if (s.absent.includes(member.id)) total++;
    }
    return { member, present, total, rate: total ? present / total : null };
  });
}

export const percent = (rate: number | null): string => (rate === null ? '–' : `${Math.round(rate * 100)} %`);
