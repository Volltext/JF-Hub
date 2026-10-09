import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { formatDate } from '@/core/domain/format';
import { SyncBadge } from './SyncBadge';
import type { Protokoll } from './model';
import { extractText } from './search';

/**
 * Protokoll, dessen Inhalt diese App-Version nicht vollständig versteht (zum Beispiel eine Tabelle aus einer neueren Version).
 * Es wird nur als Text gezeigt und nie gespeichert; so gehen die Elemente nicht verloren, die ein Editor verwerfen würde.
 */
export function UnreadableProtokoll({ doc, backTo }: { doc: Protokoll; backTo: string }) {
  const meta = [doc.datum && formatDate(doc.datum, true), [doc.beginn, doc.ende].filter(Boolean).join('–'), doc.ort, doc.leitung].filter(Boolean).join(' · ');
  return (
    <div className="proto">
      <div className="proto-bar">
        <Link to={backTo} className="proto-back">
          <ChevronLeft size={20} /> Protokolle
        </Link>
        <span className="proto-bar__spacer" />
        <SyncBadge compact />
      </div>
      <p role="alert" className="proto-error">
        Dieses Protokoll enthält Elemente, die diese App-Version nicht kennt (zum Beispiel aus einer neueren Version). Es wird nur gelesen und nicht verändert.
        Bitte die App aktualisieren, um es zu bearbeiten.
      </p>
      <section className="proto-sheet">
        <h1 className="page__title">{doc.title || 'Ohne Titel'}</h1>
        {meta && <p className="muted">{meta}</p>}
      </section>
      <div className="proto-sheet proto-sheet--body" aria-label="Protokolltext (nur Lesen)">
        {extractText(doc.content)
          .split('\n')
          .map((line, i) => (
            <p key={i}>{line}</p>
          ))}
      </div>
    </div>
  );
}
