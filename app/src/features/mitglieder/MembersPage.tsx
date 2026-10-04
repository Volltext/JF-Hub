import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { db } from '@/core/db/db';
import { memberRepo } from '@/core/db/repos';
import { attendanceStats, percent } from '@/core/domain/stats';
import type { Member, MemberKind } from '@/core/domain/types';
import { Button, Card, Page, Segmented, Sheet } from '@/core/ui/components';
import { confirmDialog } from '@/core/ui/dialog';

type Draft = { id?: string; name: string; kind: MemberKind; active: boolean };

export function MembersPage() {
  const members = useLiveQuery(() => db.members.orderBy('name').toArray(), []);
  const sessions = useLiveQuery(() => db.sessions.toArray(), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');

  if (!members || !sessions) return null;
  const stats = new Map(attendanceStats(members, sessions).map((s) => [s.member.id, s]));
  const groups: { kind: MemberKind; label: string }[] = [
    { kind: 'jugendlich', label: 'Jugendliche' },
    { kind: 'betreuer', label: 'Betreuer' },
  ];

  async function save() {
    if (!draft) return;
    try {
      if (draft.id) await memberRepo.update(draft.id, { name: draft.name, kind: draft.kind, active: draft.active });
      else await memberRepo.add(draft.name, draft.kind);
      setDraft(null);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  }

  const edit = (m: Member) => setDraft({ id: m.id, name: m.name, kind: m.kind, active: m.active });

  return (
    <Page title="Mitglieder" sub={`${members.filter((m) => m.active).length} aktiv`}>
      {members.length === 0 && (
        <Card>
          <p className="muted">Noch keine Mitglieder. Mit „+“ anlegen.</p>
        </Card>
      )}
      {groups.map(({ kind, label }) => {
        const list = members.filter((m) => m.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind} className="list">
            <div className="group-label">{label}</div>
            {list.map((m) => {
              const st = stats.get(m.id)!;
              return (
                <button key={m.id} className={`item ${m.active ? '' : 'item--off'}`} onClick={() => edit(m)}>
                  <div className="item__main">
                    <div className="item__title">{m.name}</div>
                    <div className="item__sub">
                      {m.active ? `${st.present} von ${st.total} Diensten` : 'inaktiv'}
                    </div>
                  </div>
                  {m.active && <span className="chip">{percent(st.rate)}</span>}
                </button>
              );
            })}
          </div>
        );
      })}

      <button className="fab" aria-label="Mitglied hinzufügen" onClick={() => setDraft({ name: '', kind: 'jugendlich', active: true })}>
        <Plus />
      </button>

      {draft && (
        <Sheet title={draft.id ? 'Mitglied bearbeiten' : 'Neues Mitglied'} onClose={() => setDraft(null)}>
          <label className="field">
            <span>Name</span>
            <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <Segmented
            value={draft.kind}
            onChange={(kind) => setDraft({ ...draft, kind })}
            options={[
              { value: 'jugendlich', label: 'Jugendlich' },
              { value: 'betreuer', label: 'Betreuer' },
            ]}
          />
          {draft.id && (
            <button className="toggle" aria-pressed={draft.active} onClick={() => setDraft({ ...draft, active: !draft.active })}>
              <span className="toggle__box">{draft.active && '✓'}</span> Aktiv
            </button>
          )}
          {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
          <Button variant="primary" onClick={save}>Speichern</Button>
          {draft.id && (
            <Button
              variant="danger"
              onClick={async () => {
                if (await confirmDialog(`${draft.name} wirklich löschen? Wer nur pausiert, setzt besser „inaktiv“.`, { danger: true, confirmLabel: 'Löschen' })) {
                  await memberRepo.remove(draft.id!);
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
