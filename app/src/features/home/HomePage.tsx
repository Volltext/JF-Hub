import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarCheck, Check, FileText, ListTodo, Mail, Shirt, Timer, Users, type LucideIcon } from 'lucide-react';
import { useMailShortcut } from '@/features/mail/useMailShortcut';
import { taskRepo } from '@/core/db/repos';
import { db } from '@/core/db/db';
import { formatDate, formatDateShort } from '@/core/domain/format';
import { todayIso } from '@/core/domain/id';
import { sortOpen } from '@/core/domain/tasks';
import { Card, Page } from '@/core/ui/components';
import { runTitle } from '@/features/wettkampf/run';
import { protokolleRepo } from '@/features/protokolle/repo';
import { upcomingServices } from '@/core/domain/serviceSchedule';
import { useServiceConfig } from '@/core/holidays/useServiceConfig';
import { clothingCounts } from './counts';

const linkStyle = { textDecoration: 'none', color: 'inherit' } as const;

function QuickAction({ to, state, icon: Icon, label, onClick, primary, badge, ariaLabel }: { to?: string; state?: object; icon: LucideIcon; label: string; onClick?: () => void; primary?: boolean; badge?: string; ariaLabel?: string }) {
  const cls = `quick${primary ? ' quick--primary' : ''}`;
  const body = (
    <>
      <span className="quick__icon">
        <Icon size={24} />
        {badge && <span className="quick__badge" aria-hidden="true">{badge}</span>}
      </span>
      <strong>{label}</strong>
    </>
  );
  if (to)
    return (
      <Link to={to} state={state} className={cls} aria-label={ariaLabel}>
        {body}
      </Link>
    );
  return (
    <button type="button" className={cls} onClick={onClick}>
      {body}
    </button>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const service = useServiceConfig();
  const mail = useMailShortcut();
  const data = useLiveQuery(async () => ({
    last: (await db.sessions.orderBy('date').reverse().first()) ?? null,
    memberCount: await db.members.filter((m) => m.active).count(),
    openTasks: sortOpen(await db.tasks.filter((t) => !t.completed).toArray()),
    lastRun: (await db.runs.orderBy('createdAt').reverse().first()) ?? null,
    // Nur die drei jüngsten lesen (nach Änderungszeit absteigend), nicht alle Protokolle samt Fotos in den Speicher holen.
    protocols: await db.protokolle.orderBy('updatedAt').reverse().filter((p) => p.deleted === 0).limit(3).toArray(),
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
  const isoOf = (ts: string) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const fresh = data.memberCount === 0;

  return (
    <Page title="Heute" sub={formatDate(today, true)}>
      {fresh && (
        <section className="card card--accent" aria-labelledby="start-title">
          <h2 id="start-title" className="onboard__title">Willkommen bei JF Hub</h2>
          <p className="muted" style={{ margin: 'var(--s-1) 0 var(--s-3)' }}>
            Ein Schritt, dann kannst du loslegen: Lege deine Gruppe an. Danach erfasst du Dienste mit einem Antippen je Person.
          </p>
          <Link to="/mitglieder" className="btn btn--primary btn--icon">
            <Users size={18} /> Gruppe anlegen
          </Link>
        </section>
      )}
      <div className="quick-grid">
        <QuickAction to="/dienste" state={{ create: true }} icon={CalendarCheck} label="Dienst erfassen" primary />
        <QuickAction icon={FileText} label="Neues Protokoll" onClick={() => void newProtocol()} />
        <QuickAction to="/aufgaben" state={{ create: true }} icon={ListTodo} label="Neue Aufgabe" />
        {mail.configured && (
          <QuickAction
            to="/mail"
            icon={Mail}
            label="E-Mail"
            badge={mail.unread ? (mail.unread > 99 ? '99+' : String(mail.unread)) : undefined}
            ariaLabel={mail.unread ? `E-Mail, ${mail.unread} ungelesen` : 'E-Mail'}
          />
        )}
        <QuickAction to="/wettkampf" icon={Timer} label="Stoppuhr" />
      </div>

      <div className="home-grid">
        {nextService && !fresh && (
          <Card title="Nächster Dienst">
            <div className="item__title">{formatDate(nextService.date, true)}</div>
            <div className="item__sub">
              {nextService.start} Uhr{service?.settings.serviceReminderEnabled ? ` · Erinnerung ${service.settings.serviceReminderLead} Min. vorher` : ''}
            </div>
          </Card>
        )}

        <Card title="Aufgaben" link={{ to: '/aufgaben', label: 'Alle' }}>
          {openTasks.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Keine offenen Aufgaben. <Link to="/aufgaben" state={{ create: true }}>Aufgabe anlegen</Link></p>
          ) : (
            <div className="stack">
              {overdue > 0 && <span className="chip chip--danger">{overdue} überfällig</span>}
              {openTasks.slice(0, 5).map((t) => (
                <div key={t.id} className="line line--task">
                  <button type="button" className="check check--sm" aria-label={`„${t.title}“ als erledigt markieren`} onClick={() => void taskRepo.setCompleted(t.id, true)}>
                    <Check size={14} strokeWidth={3} className="check__hover" />
                  </button>
                  <Link to="/aufgaben" state={{ edit: t.id }} className="line__title" style={linkStyle}>
                    {t.title}
                  </Link>
                  {t.dueDate && <span className={`line__meta${t.dueDate < today ? ' line__meta--late' : ''}`}>{t.dueDate < today ? 'überfällig · ' : ''}{formatDateShort(t.dueDate)}</span>}
                </div>
              ))}
              {openTasks.length > 5 && <Link to="/aufgaben" className="card__link">und {openTasks.length - 5} weitere</Link>}
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
            <p className="muted" style={{ margin: 0 }}>Noch kein Dienst erfasst.</p>
          )}
        </Card>

        <Card title="Zuletzt bearbeitet" link={{ to: '/protokolle', label: 'Alle' }}>
          {protocols.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Noch keine Protokolle.</p>
          ) : (
            <div className="stack">
              {protocols.map((p) => (
                <Link key={p.id} to={`/protokolle/${p.id}`} style={linkStyle}>
                  <div className="item__title">{p.title || 'Ohne Titel'}</div>
                  <div className="item__sub">{[p.datum && formatDateShort(p.datum), p.ort].filter(Boolean).join(' · ') || 'Protokoll'}</div>
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
            <div className="item__sub">{formatDateShort(isoOf(lastRun.createdAt))}</div>
          </Card>
        )}
      </div>

    </Page>
  );
}
