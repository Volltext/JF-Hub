import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, Users } from 'lucide-react';
import { db } from '@/core/db/db';
import { memberRepo } from '@/core/db/repos';
import { attendanceStats, percent } from '@/core/domain/stats';
import type { Member, MemberKind } from '@/core/domain/types';
import { Button, EmptyState, Page, Segmented, Sheet } from '@/core/ui/components';
import { confirmDialog } from '@/core/ui/dialog';

type Draft = { id?: string; name: string; kind: MemberKind; active: boolean };

export function MembersPage() {
  const members = useLiveQuery(() => db.members.orderBy('name').toArray(), []);
  const sessions = useLiveQuery(() => db.sessions.toArray(), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [initial, setInitial] = useState('');
  const [query, setQuery] = useState('');
  const begin = (d: Draft) => {
    setDraft(d);
    setInitial(JSON.stringify(d));
    setError('');
  };

  if (!members || !sessions) return null;
  const stats = new Map(attendanceStats(members, sessions).map((s) => [s.member.id, s]));
  const groups: { kind: MemberKind; label: string }[] = [
    { kind: 'jugendlich', label: 'Jugendliche' },
    { kind: 'betreuer', label: 'Betreuer' },
  ];

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) return setError('Bitte gib einen Namen ein.');
    try {
      if (draft.id) await memberRepo.update(draft.id, { name: draft.name, kind: draft.kind, active: draft.active });
      else await memberRepo.add(draft.name, draft.kind);
      setDraft(null);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  }

  const edit = (m: Member) => begin({ id: m.id, name: m.name, kind: m.kind, active: m.active });
  const create = () => begin({ name: '', kind: 'jugendlich', active: true });
  const q = query.trim().toLowerCase();
  const shown = q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members;

  return (
    <Page title="Mitglieder" fromMore sub={`${members.filter((m) => m.active).length} aktiv`} create={{ label: 'Mitglied hinzufügen', onClick: create }}>
      {members.length > 8 && (
        <label className="search-field">
          <Search size={18} aria-hidden="true" />
          <input className="search" type="search" placeholder="Name suchen" aria-label="Mitglieder durchsuchen" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {q && shown.length === 0 && <p className="muted">Niemand mit „{query.trim()}“ gefunden.</p>}
      {members.length === 0 && (
        <EmptyState icon={Users} title="Noch keine Mitglieder" action={<Button variant="primary" onClick={create}>Mitglied anlegen</Button>}>
          Lege deine Gruppe an, dann kannst du Dienste und Anwesenheit erfassen.
        </EmptyState>
      )}
      {groups.map(({ kind, label }) => {
        const list = shown.filter((m) => m.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind} className="list">
            <h2 className="group-label">{label}</h2>
            {list.map((m) => {
              const st = stats.get(m.id)!;
              return (
                <button key={m.id} className={`item ${m.active ? '' : 'item--off'}`} onClick={() => edit(m)}>
                  <div className="item__main">
                    <div className="item__title">{m.name}</div>
                    <div className="item__sub">
                      {m.active ? (st.total ? `${st.present} von ${st.total} Diensten da` : 'noch kein Dienst erfasst') : 'inaktiv – zählt nicht mehr bei Diensten'}
                    </div>
                  </div>
                  {m.active && st.rate !== null && (
                    <span className={`chip ${st.rate >= 0.8 ? 'chip--ok' : st.rate >= 0.5 ? 'chip--warn' : 'chip--danger'}`} aria-label={`Anwesenheit ${percent(st.rate)}`}>
                      {percent(st.rate)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}



      {draft && (
        <Sheet
          title={draft.id ? 'Mitglied bearbeiten' : 'Neues Mitglied'}
          onClose={() => setDraft(null)}
          dirty={JSON.stringify(draft) !== initial}
          footer={
            <>
              {error && <p role="alert" className="form-error">{error}</p>}
              <Button variant="primary" onClick={save}>
                {draft.id ? 'Änderungen speichern' : 'Mitglied anlegen'}
              </Button>
              {draft.id && (
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (await confirmDialog(`${draft.name} wirklich löschen? Die Anwesenheit in alten Diensten geht verloren. Wer nur pausiert, setzt besser „inaktiv“.`, { danger: true, confirmLabel: 'Löschen' })) {
                      await memberRepo.remove(draft.id!);
                      setDraft(null);
                    }
                  }}
                >
                  Mitglied löschen
                </Button>
              )}
            </>
          }
        >
          <label className="field">
            <span>Name</span>
            <input autoFocus={!draft.id} value={draft.name} placeholder="Vor- und Nachname" aria-invalid={!!error && !draft.name.trim()} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <div className="field">
            <span>Gehört zu</span>
            <Segmented
              value={draft.kind}
              onChange={(kind) => setDraft({ ...draft, kind })}
              options={[
                { value: 'jugendlich', label: 'Jugendliche' },
                { value: 'betreuer', label: 'Betreuer' },
              ]}
            />
          </div>
          {draft.id && (
            <div className="stack">
              <button className="toggle toggle--switch" aria-pressed={draft.active} onClick={() => setDraft({ ...draft, active: !draft.active })}>
                Aktiv in der Gruppe
                <span className="switch" aria-hidden="true" />
              </button>
              <p className="field__hint" style={{ margin: 0 }}>
                {draft.active ? 'Erscheint beim Dienst erfassen und in der Kleidertabelle.' : 'Pausiert: erscheint nicht mehr beim Dienst erfassen, alte Anwesenheit bleibt erhalten.'}
              </p>
            </div>
          )}
        </Sheet>
      )}
    </Page>
  );
}
