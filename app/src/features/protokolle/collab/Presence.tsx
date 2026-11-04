import { Users } from 'lucide-react';
import { useDirectory } from '@/core/account/account';

/** „Anna ist auch hier“, „Anna und Ben sind auch hier“, „Anna, Ben und 2 weitere sind auch hier“. */
export function peersLabel(names: string[]): string {
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} ist auch hier`;
  if (names.length === 2) return `${names[0]} und ${names[1]} sind auch hier`;
  if (names.length === 3) return `${names[0]}, ${names[1]} und ${names[2]} sind auch hier`;
  return `${names[0]}, ${names[1]} und ${names.length - 2} weitere sind auch hier`;
}

/**
 * Wer dieses Protokoll gerade geöffnet hat (laut Server die letzten Sekunden). Die Zeile bleibt als Hinweisbereich eingehängt, damit
 * Screenreader es melden, wenn jemand dazukommt oder geht; ohne Mitschreibende ist sie leer und nimmt keinen Platz (nicht `hidden`: Ein
 * ausgeblendeter Bereich fehlt im Baum der Hilfstechniken, und Änderungen darin werden nicht angesagt).
 */
export function Presence({ ids }: { ids: string[] }) {
  const users = useDirectory();
  const names = ids.map((id) => users.find((u) => u.id === id)?.name ?? 'Jemand');
  const text = peersLabel(names);
  return (
    <p className={text ? 'proto-peers' : 'proto-peers proto-peers--empty'} role="status" aria-live="polite">
      {text && <Users size={16} aria-hidden="true" />}
      {text}
    </p>
  );
}
