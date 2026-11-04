import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { db } from '@/core/db/db';
import { formatDate } from '@/core/domain/format';
import { Button, Card } from '@/core/ui/components';
import { useAccount } from '@/core/account/account';
import { ProtoError, loadConn, request } from './http';
import { syncNow } from './sync';
import { SyncBadge } from './SyncBadge';
import { daysLeft, isoOf, leftLabel, type Trash } from './trash';

/** Gelöschte Protokolle: bleiben auf dem Server einige Tage erhalten und lassen sich hier zurückholen. */
export function ProtokollPapierkorb() {
  const navigate = useNavigate();
  const account = useAccount();
  const [trash, setTrash] = useState<Trash | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setTrash(await request<Trash>(await loadConn(), 'GET', '/api/protocols/trash'));
      setError('');
    } catch (e) {
      setError(e instanceof ProtoError && e.status === 0 && e.message.startsWith('Keine Verbindung') ? 'Der Papierkorb liegt auf dem Server und braucht eine Verbindung.' : e instanceof Error ? e.message : 'Der Papierkorb konnte nicht geladen werden.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(id: string) {
    setBusy(id);
    setNote('');
    try {
      await request(await loadConn(), 'POST', `/api/protocols/${encodeURIComponent(id)}/restore`);
      // Lief schon ein Abgleich, bekommt `syncNow` dessen Ergebnis, und er kann vor dem Zurückholen begonnen haben: dann noch einmal.
      for (let round = 0; round < 2 && !(await db.protokolle.get(id)); round++) await syncNow();
      if (await db.protokolle.get(id)) {
        navigate(`/protokolle/${id}`);
        return;
      }
      setNote('Zurückgeholt. Das Protokoll erscheint beim nächsten Abgleich in der Liste.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Das Protokoll konnte nicht zurückgeholt werden.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="proto">
      <div className="proto-bar">
        <Link to="/protokolle" className="proto-back">
          <ChevronLeft size={20} /> Protokolle
        </Link>
        <span className="proto-bar__spacer" />
        <SyncBadge compact />
      </div>
      <h1 className="page__title">Papierkorb</h1>
      {trash && <p className="muted">Gelöschte Protokolle bleiben {trash.trashDays} Tage erhalten. Danach werden sie endgültig entfernt.</p>}
      {error && (
        <p role="alert" className="proto-error">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="proto-notice">
          {note}
        </p>
      )}
      {trash && trash.items.length === 0 && (
        <Card>
          <p className="muted">Der Papierkorb ist leer.</p>
        </Card>
      )}
      {trash && trash.items.length > 0 && (
        <div className="list">
          {trash.items.map((i) => (
            <div key={i.id} className="item">
              <div className="item__main">
                <div className="item__title">{i.title || 'Ohne Titel'}</div>
                <div className="item__sub">
                  {[i.datum && formatDate(i.datum), `gelöscht am ${formatDate(isoOf(i.deletedAt))}`, i.ownerId !== account?.id && i.owner ? `von ${i.owner}` : '', leftLabel(daysLeft(i.deletedAt, trash.trashDays))]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <Button onClick={() => void restore(i.id)} disabled={busy !== ''}>
                {busy === i.id ? 'Holt zurück …' : 'Zurückholen'}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
