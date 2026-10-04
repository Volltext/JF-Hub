export type ID = string;

export type MemberKind = 'jugendlich' | 'betreuer';

export interface Member {
  id: ID;
  name: string;
  kind: MemberKind;
  active: boolean;
}

/** Ein Dienst mit Anwesenheit. `date` im Format YYYY-MM-DD. */
export interface Session {
  id: ID;
  date: string;
  present: ID[];
  absent: ID[];
  savedAt: string;
}

export type Priority = 'low' | 'medium' | 'high';

export interface Task {
  id: ID;
  title: string;
  description: string;
  dueDate: string | null;
  priority: Priority;
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
  sessionId: ID | null;
  /** true = für alle Betreuer sichtbar, sonst nur für den Besitzer. */
  shared?: boolean;
  /** Besitzer (Benutzer-ID); fehlt bei lokal angelegten, noch nie abgeglichenen Aufgaben. */
  ownerId?: string;
  /** Benutzer-ID dessen, der die Aufgabe erledigt hat. */
  completedBy?: string;
}

export interface KeyValue<T = unknown> {
  key: string;
  value: T;
}
