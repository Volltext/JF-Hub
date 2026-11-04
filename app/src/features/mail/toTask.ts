import type { TaskInput } from '@/core/db/repos';
import { shortAddress, formatDateTime } from './compose';
import type { MailMessage } from './api';

const MAX_DESCRIPTION = 400;

/** Aus einer Mail eine Aufgabe machen: Betreff als Titel, Absender, Datum und der Anfang des Textes als Beschreibung. */
export function taskFromMail(msg: Pick<MailMessage, 'subject' | 'from' | 'date' | 'text'>, due: string | null): TaskInput {
  const body = msg.text.replace(/\s+/g, ' ').trim();
  const head = `Mail von ${shortAddress(msg.from)}${msg.date ? ` vom ${formatDateTime(msg.date)}` : ''}`;
  const description = body ? `${head}: ${body.length > MAX_DESCRIPTION ? `${body.slice(0, MAX_DESCRIPTION).trimEnd()} …` : body}` : head;
  return { title: msg.subject.trim() || `Mail von ${shortAddress(msg.from)}`, description, dueDate: due, priority: 'medium', sessionId: null };
}
