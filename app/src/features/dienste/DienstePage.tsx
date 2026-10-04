import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Plus } from 'lucide-react';
import { db } from '@/core/db/db';
import { sessionRepo } from '@/core/db/repos';
import { todayIso } from '@/core/domain/id';
import { formatDate } from '@/core/domain/format';
import type { ID, Member, Session } from '@/core/domain/types';
import { Button, Card, Page, Sheet } from '@/core/ui/components';
import { DateField } from '@/core/ui/pickers';
import { confirmDialog } from '@/core/ui/dialog';

export function DienstePage() {
  const members = useLiveQuery(() => db.members.orderBy('name').toArray(), []);
  const sessions = useLiveQuery(() => db.sessions.orderBy('date').reverse().toArray(), []);
  const location = useLocation();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<{ date: string; present: ID[]; existing: Session | null } | null>(null);

  function open(date: string) {
    const existing = sessions?.find((s) => s.date === date) ?? null;
    setEditing({ date, present: existing?.present ?? [], existing });
  }

  // „Heute erfassen“ von der Startseite öffnet direkt das Erfassen-Sheet.
  useEffect(() => {
    // Auch der Link einer Push-Benachrichtigung (`?neu=1`) öffnet das Erfassen.
    const fromPush = new URLSearchParams(location.search).get('neu') === '1';
    if (sessions && ((location.state as { create?: boolean } | null)?.create || fromPush)) {
      if (fromPush) navigate('/dienste', { replace: true });
      else window.history.replaceState({}, '');
      open(todayIso());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions !== undefined, location.key]);

  if (!members || !sessions) return null;
  const active = members.filter((m) => m.active);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  return (
    <Page title="Dienste" sub={`${sessions.length} erfasst`}>
      {sessions.length === 0 && (
        <Card>
          <p className="muted">Noch kein Dienst erfasst. Mit „+“ den ersten Dienst anlegen.</p>
        </Card>
      )}
      <div className="list">
        {sessions.map((s) => {
          const total = s.present.length + s.absent.length;
          return (
            <button key={s.id} className="item" onClick={() => open(s.date)}>
              <div className="item__main">
                <div className="item__title">{formatDate(s.date)}</div>
                <div className="item__sub">
                  {s.present.map((id) => nameOf.get(id)).filter(Boolean).slice(0, 3).join(', ')}
                  {s.present.length > 3 ? ' …' : ''}
                </div>
              </div>
              <span className="chip">
                {s.present.length}/{total}
              </span>
            </button>
          );
        })}
      </div>

      <button className="fab" aria-label="Dienst erfassen" onClick={() => open(todayIso())}>
        <Plus />
      </button>

      {editing && (
        <AttendanceSheet
          key={editing.date}
          members={active}
          state={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onDateChange={open}
        />
      )}
    </Page>
  );
}

function AttendanceSheet(props: {
  members: Member[];
  state: { date: string; present: ID[]; existing: Session | null };
  onChange: (s: { date: string; present: ID[]; existing: Session | null }) => void;
  onClose: () => void;
  onDateChange: (date: string) => void;
}) {
  const { members, state, onChange, onClose } = props;
  const present = new Set(state.present);
  const toggle = (id: ID) => {
    const next = new Set(present);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange({ ...state, present: [...next] });
  };
  const setAll = (ids: ID[]) => onChange({ ...state, present: ids });

  return (
    <Sheet title={state.existing ? 'Dienst bearbeiten' : 'Dienst erfassen'} onClose={onClose}>
      <DateField label="Datum" value={state.date} max={todayIso()} onChange={(v) => v && props.onDateChange(v)} />
      <div className="row">
        <Button onClick={() => setAll(members.map((m) => m.id))}>Alle</Button>
        <Button onClick={() => setAll([])}>Keiner</Button>
        <span className="muted" style={{ marginLeft: 'auto' }}>
          {present.size}/{members.length}
        </span>
      </div>
      {(['jugendlich', 'betreuer'] as const).map((kind) => {
        const list = members.filter((m) => m.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind} className="list">
            <div className="group-label">{kind === 'jugendlich' ? 'Jugendliche' : 'Betreuer'}</div>
            {list.map((m) => (
              <button key={m.id} className="toggle" aria-pressed={present.has(m.id)} onClick={() => toggle(m.id)}>
                <span className="toggle__box">{present.has(m.id) && <Check size={14} />}</span>
                {m.name}
              </button>
            ))}
          </div>
        );
      })}
      {members.length === 0 && <p className="muted">Lege zuerst unter „Mehr → Mitglieder“ Mitglieder an.</p>}
      <Button
        variant="primary"
        onClick={async () => {
          await sessionRepo.save(state.date, state.present);
          onClose();
        }}
      >
        Speichern
      </Button>
      {state.existing && (
        <Button
          variant="danger"
          onClick={async () => {
            if (await confirmDialog('Diesen Dienst löschen?', { danger: true, confirmLabel: 'Löschen' })) {
              await sessionRepo.remove(state.existing!.id);
              onClose();
            }
          }}
        >
          Dienst löschen
        </Button>
      )}
    </Sheet>
  );
}
