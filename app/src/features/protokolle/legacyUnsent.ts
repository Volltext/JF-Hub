import { newId } from '@/core/domain/id';
import { META_FIELDS, stampMeta, type Protokoll } from './model';

/**
 * Protokolle aus der Zeit vor 3.0.0 mit ungesendeten Änderungen (Datenbank-Update, Sicherung einer älteren Version): Sie können den
 * Server nicht mehr im alten Format erreichen, denn der Text wird jetzt zusammengeführt statt als Ganzes ersetzt. Ihre Fassung bleibt als
 * eigenes neues Protokoll „… (lokale Fassung)“ erhalten und geht normal hoch; das Original gleicht sich mit dem Server ab.
 *
 * Liefert die Kopien und die Kennungen der Originale, die danach nicht mehr vorgemerkt sind.
 */
export function preserveUnsent(rows: Protokoll[], now = Date.now()): { copies: Protokoll[]; cleaned: string[] } {
  const copies: Protokoll[] = [];
  const cleaned: string[] = [];
  for (const p of rows) {
    if (p.dirty !== 1 || p.deleted === 1 || !(p.rev > 0)) continue;
    const { ownerId: _owner, rejected: _rejected, legacy: _legacy, textRev: _textRev, ...rest } = p;
    void _owner, _rejected, _legacy, _textRev;
    copies.push({ ...rest, id: newId(), title: `${p.title || 'Ohne Titel'} (lokale Fassung)`, rev: 0, dirty: 1, updatedAt: now, metaAt: stampMeta(undefined, META_FIELDS, now) });
    cleaned.push(p.id);
  }
  return { copies, cleaned };
}
