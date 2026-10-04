import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Plus } from 'lucide-react';
import { db } from '@/core/db/db';
import { taskRepo, type TaskInput } from '@/core/db/repos';
import { formatDate } from '@/core/domain/format';
import { todayIso } from '@/core/domain/id';
import { dueState, sortOpen, type DueState } from '@/core/domain/tasks';
import type { Priority, Task } from '@/core/domain/types';
import { Button, Card, Page, Segmented, Sheet } from '@/core/ui/components';
import { DateField, SelectField } from '@/core/ui/pickers';
import { confirmDialog } from '@/core/ui/dialog';
import { isMine, useAccount, useDirectory, visibilityLabel } from '@/core/account/account';
import { loadSettings } from '@/core/settings/settings';

const EMPTY: TaskInput = { title: '', description: '', dueDate: null, priority: 'medium', sessionId: null };

const DUE_LABEL: Record<DueState, string | null> = {
  overdue: 'überfällig',
  today: 'heute',
  soon: 'bald',
  later: null,
  none: null,
};

export function TasksPage() {
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const sessions = useLiveQuery(() => db.sessions.orderBy('date').reverse().limit(10).toArray(), []);
  const account = useAccount();
  const users = useDirectory();
  const defaultShared = useLiveQuery(async () => (await loadSettings()).defaultShared, []) ?? false;
  const [draft, setDraft] = useState<(TaskInput & { id?: string; ownerId?: string }) | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState('');
  const location = useLocation();

  // „Neue Aufgabe“ von der Startseite öffnet direkt das Erfassen-Fenster.
  useEffect(() => {
    if ((location.state as { create?: boolean } | null)?.create) {
      window.history.replaceState({}, '');
      setDraft({ ...EMPTY, shared: defaultShared });
    }
  }, [location.key]);

  if (!tasks || !sessions) return null;
  const today = todayIso();
  const mine = !draft?.id || isMine({ ownerId: draft.ownerId }, account);
  const canDelete = mine || account?.role === 'admin';
  const open = sortOpen(tasks.filter((t) => !t.completed));
  const done = tasks
    .filter((t) => t.completed)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));

  async function save() {
    if (!draft) return;
    const { id, ownerId: _owner, ...input } = draft;
    void _owner;
    try {
      if (id) await taskRepo.update(id, input);
      else await taskRepo.add(input);
      setDraft(null);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  }

  const edit = (t: Task) =>
    setDraft({
      id: t.id,
      title: t.title,
      description: t.description,
      dueDate: t.dueDate,
      priority: t.priority,
      sessionId: t.sessionId,
      shared: t.shared === true,
      ownerId: t.ownerId,
    });
  const nameOf = (id?: string) => users.find((u) => u.id === id)?.name;

  const row = (t: Task) => {
    const state = dueState(t.dueDate, today);
    const label = t.completed ? null : DUE_LABEL[state];
    return (
      <div key={t.id} className={`item ${t.completed ? 'item--off' : ''}`} style={{ cursor: 'default' }}>
        <button
          className="toggle__box"
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: t.completed ? 'var(--success)' : 'transparent',
            color: '#fff',
            cursor: 'pointer',
          }}
          aria-label={t.completed ? 'Wieder öffnen' : 'Als erledigt markieren'}
          onClick={() => taskRepo.setCompleted(t.id, !t.completed)}
        >
          {t.completed && <Check size={18} />}
        </button>
        <button
          className="item__main"
          style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0 }}
          onClick={() => edit(t)}
        >
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
        </button>
        {(t.shared || !isMine(t, account)) && <span className="chip">{visibilityLabel(t, account, users)}</span>}
        {label && <span className={`chip ${state === 'overdue' ? 'chip--warn' : ''}`}>{label}</span>}
        {!t.completed && t.priority === 'high' && <span className="chip chip--warn">hoch</span>}
      </div>
    );
  };

  return (
    <Page title="Aufgaben" sub={`${open.length} offen`}>
      {open.length === 0 && (
        <Card>
          <p className="muted">Nichts zu tun. Mit „+“ eine Aufgabe anlegen.</p>
        </Card>
      )}
      <div className="list">{open.map(row)}</div>

      {done.length > 0 && (
        <>
          <Button onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Erledigte ausblenden' : `Erledigte anzeigen (${done.length})`}
          </Button>
          {showDone && <div className="list">{done.map(row)}</div>}
        </>
      )}

      <button className="fab" aria-label="Aufgabe hinzufügen" onClick={() => setDraft({ ...EMPTY, shared: defaultShared })}>
        <Plus />
      </button>

      {draft && (
        <Sheet title={draft.id ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'} onClose={() => setDraft(null)}>
          <label className="field">
            <span>Titel</span>
            <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label className="field">
            <span>Beschreibung</span>
            <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <DateField label="Fällig am" clearable value={draft.dueDate} onChange={(dueDate) => setDraft({ ...draft, dueDate })} />
          <div className="field">
            <span>Priorität</span>
            <Segmented<Priority>
              value={draft.priority}
              onChange={(priority) => setDraft({ ...draft, priority })}
              options={[
                { value: 'low', label: 'Niedrig' },
                { value: 'medium', label: 'Mittel' },
                { value: 'high', label: 'Hoch' },
              ]}
            />
          </div>
          <SelectField
            label="Zu Dienst (optional)"
            value={draft.sessionId ?? ''}
            options={[{ value: '', label: '–' }, ...sessions.map((s) => ({ value: s.id, label: formatDate(s.date) }))]}
            onChange={(v) => setDraft({ ...draft, sessionId: v || null })}
          />
          {mine ? (
            <div className="stack">
              <button className="toggle" aria-pressed={draft.shared === true} onClick={() => setDraft({ ...draft, shared: !draft.shared })}>
                <span className="toggle__box">{draft.shared && '✓'}</span> Für alle Betreuer veröffentlichen
              </button>
              <p className="muted">
                {draft.shared ? 'Alle Betreuer sehen diese Aufgabe, können sie bearbeiten und abhaken. Löschen kannst nur du.' : 'Nur du siehst diese Aufgabe.'}
              </p>
            </div>
          ) : (
            <p className="muted">
              Veröffentlicht von {nameOf(draft.ownerId) ?? 'einem anderen Betreuer'}. Du kannst die Aufgabe bearbeiten und abhaken; zurücknehmen und löschen kann nur {nameOf(draft.ownerId) ?? 'die Person'}
              {account?.role === 'admin' ? ' (und du als Admin)' : ''}.
            </p>
          )}
          {error && (
            <p role="alert" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}
          <Button variant="primary" onClick={save}>
            Speichern
          </Button>
          {draft.id && canDelete && (
            <Button
              variant="danger"
              onClick={async () => {
                if (await confirmDialog('Aufgabe löschen?', { danger: true, confirmLabel: 'Löschen' })) {
                  await taskRepo.remove(draft.id!);
                  setDraft(null);
                }
              }}
            >
              Löschen
            </Button>
          )}
        </Sheet>
      )}
    </Page>
  );
}
