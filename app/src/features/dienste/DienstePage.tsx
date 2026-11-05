import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarCheck, Check, Users } from 'lucide-react';
import { db } from '@/core/db/db';
import { sessionRepo } from '@/core/db/repos';
import { todayIso } from '@/core/domain/id';
import { formatDate, formatDateShort } from '@/core/domain/format';
import type { ID, Member, Session } from '@/core/domain/types';
import { Button, Card, EmptyState, Page, Sheet } from '@/core/ui/components';
import { MiniBars } from '@/core/ui/charts';
import { DateField } from '@/core/ui/pickers';
import { confirmDialog } from '@/core/ui/dialog';
import { useServiceConfig } from '@/core/holidays/useServiceConfig';

type Editing = { date: string; present: ID[]; existing: Session | null; initial: ID[] };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Vorschlag fürs Datum: der letzte Diensttag (laut Einstellungen), solange er noch nicht erfasst ist –
 * typisch ist das Nachtragen am Tag danach. Sonst heute.
 */
export function suggestDate(sessions: Session[], weekday: number | undefined, today = new Date()): string {
  if (weekday === undefined) return iso(today);
  const back = (today.getDay() - weekday + 7) % 7;
  const last = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - back));
  return sessions.some((s) => s.date === last) ? iso(today) : last;
}

const monthLabel = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
};

export function DienstePage() {
  const members = useLiveQuery(() => db.members.orderBy('name').toArray(), []);
  const sessions = useLiveQuery(() => db.sessions.orderBy('date').reverse().toArray(), []);
  const service = useServiceConfig();
  const location = useLocation();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Editing | null>(null);

  function open(date: string) {
    const existing = sessions?.find((s) => s.date === date) ?? null;
    const present = existing?.present ?? [];
    setEditing({ date, present, existing, initial: present });
  }
  const openSuggested = () => open(suggestDate(sessions ?? [], service?.config.weekday));

  // „Dienst erfassen“ von der Startseite oder aus einer Benachrichtigung (`?neu=1`) öffnet direkt das Erfassen.
  useEffect(() => {
    const fromPush = new URLSearchParams(location.search).get('neu') === '1';
    if (sessions && service && ((location.state as { create?: boolean } | null)?.create || fromPush)) {
      if (fromPush) navigate('/dienste', { replace: true });
      else window.history.replaceState({}, '');
      openSuggested();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions !== undefined, service !== null, location.key]);

  const recent = useMemo(() => (sessions ?? []).slice(0, 12).reverse(), [sessions]);

  if (!members || !sessions) return null;
  const active = members.filter((m) => m.active);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const rate = (s: Session) => {
    const total = s.present.length + s.absent.length;
    return total ? s.present.length / total : 0;
  };
  const avg = recent.length ? recent.reduce((sum, s) => sum + rate(s), 0) / recent.length : 0;

  // Nach Monaten gruppieren: lange Listen bleiben überschaubar.
  const months: { label: string; items: Session[] }[] = [];
  for (const s of sessions) {
    const label = monthLabel(s.date);
    const last = months.at(-1);
    if (last?.label === label) last.items.push(s);
    else months.push({ label, items: [s] });
  }

  return (
    <Page
      title="Dienste"
      sub={sessions.length ? `${sessions.length} ${sessions.length === 1 ? 'Dienst' : 'Dienste'} erfasst` : 'Anwesenheit je Dienstabend'}
      create={active.length ? { label: 'Dienst erfassen', onClick: openSuggested } : undefined}
    >
      {active.length === 0 ? (
        <EmptyState icon={Users} title="Zuerst die Gruppe anlegen" action={<Link to="/mitglieder" className="btn btn--primary">Zu den Mitgliedern</Link>}>
          Für die Anwesenheit braucht JF Hub die Namen deiner Jugendlichen und Betreuer.
        </EmptyState>
      ) : sessions.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="Noch kein Dienst erfasst" action={<Button variant="primary" onClick={openSuggested}>Ersten Dienst erfassen</Button>}>
          Halte fest, wer da war – so entsteht die Anwesenheitsübersicht.
        </EmptyState>
      ) : (
        <Card title={`Anwesenheit · letzte ${recent.length} ${recent.length === 1 ? 'Dienst' : 'Dienste'}`}>
          <div className="stat-row">
            <span className="stat-row__value">{Math.round(avg * 100)} %</span>
            <span className="muted">im Schnitt anwesend</span>
          </div>
          <MiniBars
            summary={`Anwesenheit der letzten ${recent.length} Dienste, im Schnitt ${Math.round(avg * 100)} Prozent`}
            points={recent.map((s) => ({
              label: formatDateShort(s.date),
              value: rate(s),
              title: `${formatDateShort(s.date)}: ${s.present.length} von ${s.present.length + s.absent.length} anwesend`,
            }))}
          />
        </Card>
      )}

      {months.map((m) => (
        <section key={m.label} className="list" aria-label={m.label}>
          <h2 className="group-label">{m.label}</h2>
          {m.items.map((s) => {
            const total = s.present.length + s.absent.length;
            return (
              <button key={s.id} className="item" onClick={() => open(s.date)}>
                <div className="item__main">
                  <div className="item__title">{formatDate(s.date)}</div>
                  <div className="item__sub item__sub--line">
                    {s.present.map((id) => nameOf.get(id)).filter(Boolean).slice(0, 2).join(', ')}
                    {s.present.length > 2 ? ` und ${s.present.length - 2} weitere` : ''}
                  </div>
                </div>
                <span className="chip" aria-label={`${s.present.length} von ${total} anwesend`}>
                  {s.present.length}/{total}
                </span>
              </button>
            );
          })}
        </section>
      ))}

      {editing && (
        <AttendanceSheet
          members={active}
          state={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onDateChange={async (date) => {
            const existing = sessions.find((s) => s.date === date) ?? null;
            if (existing) {
              // Für diesen Tag gibt es schon einen Eintrag: den laden (nach Rückfrage, falls schon etwas angehakt ist).
              const changed = editing.present.join() !== editing.initial.join();
              if (changed && !(await confirmDialog(`Für ${formatDate(date)} ist schon ein Dienst erfasst. Diesen öffnen? Deine Häkchen hier gehen dabei verloren.`, { confirmLabel: 'Öffnen', cancelLabel: 'Hier bleiben' }))) return;
              setEditing({ date, present: existing.present, existing, initial: existing.present });
            } else {
              // Neuer Tag: die Häkchen bleiben erhalten.
              setEditing({ ...editing, date, existing: null });
            }
          }}
        />
      )}
    </Page>
  );
}

function AttendanceSheet(props: {
  members: Member[];
  state: Editing;
  onChange: (s: Editing) => void;
  onClose: () => void;
  onDateChange: (date: string) => void;
}) {
  const { members, state, onChange, onClose } = props;
  const present = new Set(state.present);
  const dirty = [...present].sort().join() !== [...state.initial].sort().join() || (!state.existing && present.size > 0);
  const toggle = (id: ID) => {
    const next = new Set(present);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange({ ...state, present: [...next] });
  };
  const setAll = (ids: ID[]) => onChange({ ...state, present: ids });

  return (
    <Sheet
      title={state.existing ? 'Dienst bearbeiten' : 'Dienst erfassen'}
      onClose={onClose}
      dirty={dirty}
      wide
      footer={
        <>
          <Button
            variant="primary"
            onClick={async () => {
              await sessionRepo.save(state.date, state.present);
              onClose();
            }}
          >
            Speichern · {present.size} von {members.length} anwesend
          </Button>
          {state.existing && (
            <Button
              variant="danger"
              onClick={async () => {
                if (await confirmDialog(`Dienst vom ${formatDate(state.date)} löschen?`, { danger: true, confirmLabel: 'Löschen' })) {
                  await sessionRepo.remove(state.existing!.id);
                  onClose();
                }
              }}
            >
              Dienst löschen
            </Button>
          )}
        </>
      }
    >
      <DateField label="Datum" value={state.date} max={todayIso()} onChange={(v) => v && props.onDateChange(v)} />
      <div className="row">
        <Button onClick={() => setAll(members.map((m) => m.id))}>Alle da</Button>
        <Button onClick={() => setAll([])}>Keiner</Button>
        <span className="muted" style={{ marginLeft: 'auto' }} aria-live="polite">
          {present.size} von {members.length}
        </span>
      </div>
      {(['jugendlich', 'betreuer'] as const).map((kind) => {
        const list = members.filter((m) => m.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind} className="list">
            <div className="group-label">{kind === 'jugendlich' ? 'Jugendliche' : 'Betreuer'}</div>
            <div className="list toggle-grid">
              {list.map((m) => (
                <button key={m.id} className="toggle" aria-pressed={present.has(m.id)} onClick={() => toggle(m.id)}>
                  <span className="toggle__box">{present.has(m.id) && <Check size={14} />}</span>
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {members.length === 0 && (
        <p className="muted">
          Lege zuerst unter <Link to="/mitglieder">Mitglieder</Link> deine Gruppe an.
        </p>
      )}
    </Sheet>
  );
}
