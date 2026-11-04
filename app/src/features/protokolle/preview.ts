import type { JSONContent } from '@tiptap/core';
import { extractText } from './search';
import { extractTags, stripTags } from './tags';

export interface NoteInfo {
  /** Erste Zeilen des Textes ohne Tags, für die Vorschau in der Liste. */
  preview: string;
  tags: string[];
  words: number;
}

export const countWords = (text: string): number => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

/** Liest aus dem Text eines Protokolls, was die Liste zeigt: Vorschau, Tags, Wortzahl. */
export function noteInfo(content: JSONContent | undefined, maxChars = 140): NoteInfo {
  const text = extractText(content);
  const lines = stripTags(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  let preview = lines.join(' · ');
  if (preview.length > maxChars) preview = `${preview.slice(0, maxChars).trimEnd()}…`;
  return { preview, tags: extractTags(text), words: countWords(text) };
}

/** Lesezeit in ganzen Minuten (200 Wörter pro Minute), mindestens 1, sobald es Text gibt. */
export const readingMinutes = (words: number): number => (words === 0 ? 0 : Math.max(1, Math.round(words / 200)));
