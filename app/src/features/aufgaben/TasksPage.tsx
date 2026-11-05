import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ListChecks } from 'lucide-react';
import { db } from '@/core/db/db';
import { taskRepo, type TaskInput } from '@/core/db/repos';
import { formatDate } from '@/core/domain/format';
import { todayIso } from '@/core/domain/id';
import { dueState, sortOpen, type DueState } from '@/core/domain/tasks';
import type { Priority, Task } from '@/core/domain/types';
import { Button, EmptyState, Page, Segmented, Sheet } from '@/core/ui/components';
import { DateField, SelectField } from '@/core/ui/pickers';
import { confirmDialog } from '@/core/ui/dialog';
import { isMine, useAccount, useDirectory, visibilityLabel } from '@/core/account/account';
import { loadSettings } from '@/core/settings/settings';

const EMPTY: TaskInput = { title: '', description: '', dueDate: null, priority: 'medium', sessionId: null };

type Draft = TaskInput & { id?: string; ownerId?: string };
type Filter = 'alle' | 'meine' | 'geteilt';

const DUE_LABEL: Record<DueState, string | null> = {
  overdue: 'überfällig',
  today: 'heute',
  soon: 'bald',
  later: null,
  none: null,
};

/** Gruppen der offenen Aufgaben: zuerst, was drängt. */
function groupOf(t: Task, today: string): string {
  if (!t.dueDate) return 'Ohne Fälligkeit';
  if (t.dueDate < today) return 'Überfällig';
  const days = (Date.parse(t.dueDate) - Date.parse(today)) / 86_400_000;
  if (days <= 7) return 'Nächste 7 Tage';
  return 'Später';
}
const GROUP_ORDER = ['Überfällig', 'Nächste 7 Tage', 'Später', 'Ohne Fälligkeit'];

export function TasksPage() {
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const sessions = useLiveQuery(() => db.sessions.orderBy('date').reverse().limit(10).toArray(), []);
  const account = useAccount();
  const users = useDirectory();
  const defaultShared = useLiveQuery(async () => (await loadSettings()).defaultShared, []) ?? false;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [initial, setInitial] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [filter, setFilter] = useState<Filter>('alle');
  const [error, setError] = useState('');
  const location = useLocation();

  const begin = (d: Draft) => {
    setDraft(d);
    setInitial(JSON.stringify(d));
    setError('');
  };
  const create = () => begin({ ...EMPTY, shared: defaultShared });
  const edit = (t: Task) =>
    begin({
      id: t.id,
      title: t.title,
      description: t.description,
      dueDate: t.dueDate,
      priority: t.priority,
      sessionId: t.sessionId,
      shared: t.shared === true,
      ownerId: t.ownerId,
    });

  // Von der Startseite: „Neue Aufgabe“ öffnet das Erfassen, ein Tipp auf eine Aufgabe öffnet genau diese.
  useEffect(() => {
    const st = location.state as { create?: boolean; edit?: string } | null;
    if (!st || !tasks) return;
    window.history.replaceState({}, '');
    if (st.create) create();
    else if (st.edit) {
      const t = tasks.find((x) => x.id === st.edit);
      if (t) edit(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key, tasks !== undefined]);

  if (!tasks || !sessions) return null;
  const today = todayIso();
  const mine = !draft?.id || isMine({ ownerId: draft.ownerId }, account);
  const canDelete = mine || account?.role === 'admin';
  const hasShared = tasks.some((t) => t.shared || !isMine(t, account));
  const visible = tasks.filter((t) =>
    filter === 'meine' ? isMine(t, account) : filter === 'geteilt' ? t.shared || !isMine(t, account) : true,
  );
  const open = sortOpen(visible.filter((t) => !t.completed));
  const done = visible.filter((t) => t.completed).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today).length;

  async function save() {
    if (!draft) return;
    if (!draft.title.trim()) return setError('Bitte gib der Aufgabe einen Titel.');
    const { id, ownerId: _owner, ...input } = draft;
    void _owner;
    try {
      if (id) await taskRepo.update(id, { ...input, title: input.title.trim() });
      else await taskRepo.add({ ...input, title: input.title.trim() });
      setDraft(null);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern hat nicht geklappt. Bitte versuche es noch einmal.');
    }
  }

  const nameOf = (id?: string) => users.find((u) => u.id === id)?.name;

  const row = (t: Task) => {
    const state = dueState(t.dueDate, today);
    const label = t.completed ? null : DUE_LABEL[state];
    const showChips = t.shared || !isMine(t, account) || label || (!t.completed && t.priority === 'high');
    return (
      <div key={t.id} className={`item item--top ${t.completed ? 'item--off' : ''}`}>
        <button
          className={`check${t.completed ? ' check--on' : ''}`}
          aria-label={t.completed ? `„${t.title}“ wieder öffnen` : `„${t.title}“ als erledigt markieren`}
          aria-pressed={t.completed}
          onClick={() => taskRepo.setCompleted(t.id, !t.completed)}
        >
          {t.completed && <Check size={18} strokeWidth={3} />}
        </button>
        <button className="item__main item__btn" onClick={() => edit(t)}>
          <div className="item__title" style={t.completed ? { textDecoration: 'line-through' } : undefined}>
            {t.title}
          </div>
          <div className="item__sub">
            {[
              t.dueDate ? formatDate(t.dueDate) : 'ohne Fälligkeit',
              t.completed && t.completedBy && t.completedBy !== account?.id ? `erledigt von ${nameOf(t.completedBy) ?? 'einem Betreuer'}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {showChips && (
            <div className="item__chips">
              {(t.shared || !isMine(t, account)) && <span className="chip">{visibilityLabel(t, account, users)}</span>}
              {label && <span className={`chip ${state === 'overdue' ? 'chip--danger' : state === 'today' ? 'chip--warn' : ''}`}>{label}</span>}
              {!t.completed && t.priority === 'high' && <span className="chip chip--warn">wichtig</span>}
            </div>
          )}
        </button>
      </div>
    );
  };

  const groups = GROUP_ORDER.map((g) => ({ label: g, items: open.filter((t) => groupOf(t, today) === g) })).filter((g) => g.items.length);
  const dirty = draft ? JSON.stringify(draft) !== initial : false;

  return (
    <Page
      title="Aufgaben"
      fromMore
      sub={open.length ? `${open.length} offen${overdue ? `, davon ${overdue} überfällig` : ''}` : 'Alles erledigt'}
      create={{ label: 'Neue Aufgabe', onClick: create }}
    >
      {hasShared && (
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'alle', label: 'Alle' },
            { value: 'meine', label: 'Meine' },
            { value: 'geteilt', label: 'Veröffentlicht' },
          ]}
        />
      )}

      {open.length === 0 && (
        <EmptyState icon={ListChecks} title={filter === 'alle' ? 'Alles erledigt' : 'Hier ist nichts offen'} action={<Button variant="primary" onClick={create}>Aufgabe anlegen</Button>}>
          {filter === 'alle' ? 'Es sind keine Aufgaben offen.' : 'In dieser Ansicht sind keine Aufgaben offen.'}
        </EmptyState>
      )}

      {groups.map((g) => (
        <section key={g.label} className="list" aria-label={g.label}>
          <h2 className={`group-label${g.label === 'Überfällig' ? ' group-label--alert' : ''}`}>
            {g.label} · {g.items.length}
          </h2>
          {g.items.map(row)}
        </section>
      ))}

      {done.length > 0 && (
        <>
          <Button onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            {showDone ? 'Erledigte ausblenden' : `Erledigte anzeigen (${done.length})`}
          </Button>
          {showDone && <div className="list">{done.map(row)}</div>}
        </>
      )}

      {draft && (
        <Sheet
          title={draft.id ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
          onClose={() => setDraft(null)}
          dirty={dirty}
          footer={
            <>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              <Button variant="primary" onClick={save}>
                {draft.id ? 'Änderungen speichern' : 'Aufgabe anlegen'}
              </Button>
              {draft.id && canDelete && (
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (await confirmDialog(`„${draft.title}“ löschen?`, { danger: true, confirmLabel: 'Löschen' })) {
                      await taskRepo.remove(draft.id!);
                      setDraft(null);
                    }
                  }}
                >
                  Aufgabe löschen
                </Button>
              )}
            </>
          }
        >
          <label className="field">
            <span>Titel</span>
            <input
              autoFocus={!draft.id}
              value={draft.title}
              placeholder="z. B. Getränke für den Elternabend besorgen"
              aria-invalid={!!error && !draft.title.trim()}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Notiz (optional)</span>
            <textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <DateField label="Fällig am (optional)" clearable value={draft.dueDate} onChange={(dueDate) => setDraft({ ...draft, dueDate })} />
          <div className="field">
            <span id="prio-label">Wichtigkeit</span>
            <Segmented<Priority>
              value={draft.priority}
              onChange={(priority) => setDraft({ ...draft, priority })}
              options={[
                { value: 'low', label: 'Niedrig' },
                { value: 'medium', label: 'Normal' },
                { value: 'high', label: 'Wichtig' },
              ]}
            />
          </div>
          <SelectField
            label="Gehört zu Dienst (optional)"
            value={draft.sessionId ?? ''}
            options={[{ value: '', label: 'Zu keinem Dienst' }, ...sessions.map((s) => ({ value: s.id, label: formatDate(s.date) }))]}
            onChange={(v) => setDraft({ ...draft, sessionId: v || null })}
          />
          {mine ? (
            <div className="stack">
              <button className="toggle toggle--switch" aria-pressed={draft.shared === true} onClick={() => setDraft({ ...draft, shared: !draft.shared })}>
                Für alle Betreuer veröffentlichen
                <span className="switch" aria-hidden="true" />
              </button>
              <p className="field__hint" style={{ margin: 0 }}>
                {draft.shared ? 'Alle Betreuer sehen diese Aufgabe, können sie bearbeiten und abhaken. Löschen kannst nur du.' : 'Nur du siehst diese Aufgabe.'}
              </p>
            </div>
          ) : (
            <p className="field__hint">
              Veröffentlicht von {nameOf(draft.ownerId) ?? 'einem anderen Betreuer'}. Du kannst die Aufgabe bearbeiten und abhaken; zurücknehmen und löschen kann nur {nameOf(draft.ownerId) ?? 'die Person'}
              {account?.role === 'admin' ? ' (und du als Admin)' : ''}.
            </p>
          )}
        </Sheet>
      )}
    </Page>
  );
}
