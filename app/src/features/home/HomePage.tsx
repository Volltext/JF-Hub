import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarCheck, FileText, ListTodo, Shirt, Timer, type LucideIcon } from 'lucide-react';
import { db } from '@/core/db/db';
import { formatDate } from '@/core/domain/format';
import { todayIso } from '@/core/domain/id';
import { sortOpen } from '@/core/domain/tasks';
import { Card, Page } from '@/core/ui/components';
import { runTitle } from '@/features/wettkampf/run';
import { protokolleRepo } from '@/features/protokolle/repo';
import { upcomingServices } from '@/core/domain/serviceSchedule';
import { useServiceConfig } from '@/core/holidays/useServiceConfig';

const linkStyle = { textDecoration: 'none', color: 'inherit' } as const;

function QuickAction({ to, state, icon: Icon, label, onClick, primary }: { to?: string; state?: object; icon: LucideIcon; label: string; onClick?: () => void; primary?: boolean }) {
  const cls = `quick${primary ? ' quick--primary' : ''}`;
  const body = (
    <>
      <Icon size={24} />
      <strong>{label}</strong>
    </>
  );
  return to ? (
    <Link to={to} state={state} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={onClick}>
      {body}
    </button>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const service = useServiceConfig();
  const data = useLiveQuery(async () => ({
    last: (await db.sessions.orderBy('date').reverse().first()) ?? null,
    memberCount: await db.members.filter((m) => m.active).count(),
    openTasks: sortOpen(await db.tasks.filter((t) => !t.completed).toArray()),
    lastRun: (await db.runs.orderBy('createdAt').reverse().first()) ?? null,
    protocols: (await db.protokolle.filter((p) => p.deleted === 0).toArray()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3),
    clothing: await clothingCounts(),
  }), []);
  if (!data) return null;
  const { last, openTasks, lastRun, protocols } = data;
  const today = todayIso();
  // Nächster Termin unabhängig von der Erinnerungszeit: Vorlauf 0 zählt bis zum Beginn.
  const nextService = service ? upcomingServices(new Date(), { ...service.config, leadMinutes: 0 }, 1)[0] : undefined;
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate < today).length;

  async function newProtocol() {
    const p = await protokolleRepo.create('');
    navigate(`/protokolle/${p.id}`);
  }

  return (
    <Page title="Heute" sub={formatDate(today, true)}>
      <div className="quick-grid">
        <QuickAction to="/dienste" state={{ create: true }} icon={CalendarCheck} label="Dienst erfassen" primary />
        <QuickAction icon={FileText} label="Neues Protokoll" onClick={() => void newProtocol()} />
        <QuickAction to="/aufgaben" state={{ create: true }} icon={ListTodo} label="Neue Aufgabe" />
        <QuickAction to="/wettkampf" icon={Timer} label="Stoppuhr" />
      </div>

      <div className="home-grid">
        {nextService && (
          <Card title="Nächster Dienst">
            <div className="item__title">{formatDate(nextService.date, true)}</div>
            <div className="item__sub">
              {nextService.start} Uhr{service?.settings.serviceReminderEnabled ? ` · Erinnerung ${service.settings.serviceReminderLead} Min. vorher` : ''}
            </div>
          </Card>
        )}

        <Card title="Aufgaben" link={{ to: '/aufgaben', label: 'Alle' }}>
          {openTasks.length === 0 ? (
            <p className="muted">Keine offenen Aufgaben.</p>
          ) : (
            <div className="stack">
              {overdue > 0 && <span className="chip chip--warn">{overdue} überfällig</span>}
              {openTasks.slice(0, 5).map((t) => (
                <div key={t.id} className="item__title">
                  {t.title}
                  {t.dueDate && <span className="item__sub"> · {formatDate(t.dueDate)}</span>}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Letzter Dienst" link={{ to: '/dienste', label: 'Alle' }}>
          {last ? (
            <div className="item__main">
              <div className="item__title">{formatDate(last.date, true)}</div>
              <div className="item__sub">
                {last.present.length} von {last.present.length + last.absent.length} anwesend
              </div>
            </div>
          ) : (
            <p className="muted">Noch kein Dienst erfasst.</p>
          )}
        </Card>

        <Card title="Zuletzt bearbeitet" link={{ to: '/protokolle', label: 'Alle' }}>
          {protocols.length === 0 ? (
            <p className="muted">Noch keine Protokolle.</p>
          ) : (
            <div className="stack">
              {protocols.map((p) => (
                <Link key={p.id} to={`/protokolle/${p.id}`} style={linkStyle}>
                  <div className="item__title">{p.title || 'Ohne Titel'}</div>
                  <div className="item__sub">{[p.datum && formatDate(p.datum), p.ort].filter(Boolean).join(' · ') || 'Protokoll'}</div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {data.clothing.open > 0 && (
          <Link to="/kleidung" state={{ tab: 'beschaffen' }} style={linkStyle}>
            <Card title="Kleidung">
              <div className="row">
                <Shirt size={20} />
                <span>
                  {data.clothing.open} {data.clothing.open === 1 ? 'Teil' : 'Teile'} zu beschaffen
                  {data.clothing.fresh > 0 && data.clothing.fresh < data.clothing.open ? ` · ${data.clothing.fresh} noch nicht beim Kleiderwart` : ''}
                  {data.clothing.fresh > 0 && data.clothing.fresh === data.clothing.open ? ' · noch nicht beim Kleiderwart' : ''}
                </span>
              </div>
            </Card>
          </Link>
        )}

        {lastRun && (
          <Card title="Letzter Lauf" link={{ to: '/wettkampf', label: 'Wettkampf' }}>
            <div className="item__title">{runTitle(lastRun)}</div>
            <div className="item__sub">{new Date(lastRun.createdAt).toLocaleDateString('de-DE', { dateStyle: 'medium' })}</div>
          </Card>
        )}
      </div>

      {data.memberCount === 0 && (
        <Card title="Erste Schritte">
          <p className="muted">
            Lege unter „Mitglieder“ deine Gruppe an.
          </p>
          <p style={{ marginTop: 'var(--s-3)' }}>
            <Link to="/mitglieder">Zu den Mitgliedern</Link>
          </p>
        </Card>
      )}
    </Page>
  );
}

/** Offene Kleidungswünsche aktiver Mitglieder (nur zu vorhandenen Kleidungsstücken); `fresh` = noch nicht weitergegeben. */
async function clothingCounts(): Promise<{ open: number; fresh: number }> {
  const active = new Set((await db.members.filter((m) => m.active).toArray()).map((m) => m.id));
  const itemIds = new Set(await db.clothingItems.toCollection().primaryKeys());
  let open = 0;
  let fresh = 0;
  for (const rec of await db.clothing.toArray()) {
    if (!active.has(rec.id)) continue;
    for (const [itemId, slot] of Object.entries(rec.items)) {
      if (!slot.request || !itemIds.has(itemId)) continue;
      open++;
      if (!slot.request.passedOn) fresh++;
    }
  }
  return { open, fresh };
}
