import { useState } from 'react';
import { Button, Card } from '@/core/ui/components';
import { DateField, SelectField, TimeField } from '@/core/ui/pickers';
import { saveSettings, type Settings } from '@/core/settings/settings';
import { ensureNotificationPermission } from '@/core/native/notifications';
import { STATES, fetchHolidays } from '@/core/holidays/holidays';
import { useServiceConfig } from '@/core/holidays/useServiceConfig';
import { seasonWindow, upcomingServices } from '@/core/domain/serviceSchedule';
import { formatDate } from '@/core/domain/format';

const WEEKDAYS = [
  { value: '1', label: 'Montag' },
  { value: '2', label: 'Dienstag' },
  { value: '3', label: 'Mittwoch' },
  { value: '4', label: 'Donnerstag' },
  { value: '5', label: 'Freitag' },
  { value: '6', label: 'Samstag' },
  { value: '0', label: 'Sonntag' },
];

const LEADS = [0, 5, 10, 15, 30, 60].map((n) => ({ value: String(n), label: n === 0 ? 'Zum Beginn' : `${n} Minuten vorher` }));

/** Wöchentlicher Dienst: Wochentag, Beginn je nach Saison (Ferien), Erinnerung. */
export function ServiceCard() {
  const service = useServiceConfig();
  const [msg, setMsg] = useState('');
  if (!service) return null;
  const { settings: s, cache, config } = service;
  const patch = (p: Partial<Settings>) => void saveSettings(p);

  const year = new Date().getFullYear();
  const win = seasonWindow(year, config.holidays, config.override);
  const next = upcomingServices(new Date(), { ...config, leadMinutes: 0 }, 3);
  const stale = cache === null || cache.state !== s.serviceState;

  async function update() {
    setMsg('Lade Ferientermine …');
    try {
      const c = await fetchHolidays(s.serviceState);
      setMsg(`${c.items.length} Ferienabschnitte geladen.`);
    } catch (e) {
      setMsg(e instanceof Error ? `Konnte nicht laden: ${e.message}` : 'Konnte nicht laden.');
    }
  }

  return (
    <Card title="Wöchentlicher Dienst">
      <div className="stack">
        <button
          className="toggle toggle--switch"
          aria-pressed={s.serviceReminderEnabled}
          onClick={async () => {
            const enabled = !s.serviceReminderEnabled;
            patch({ serviceReminderEnabled: enabled });
            if (enabled && !(await ensureNotificationPermission()))
              setMsg('Benachrichtigungen sind in den Android-Einstellungen nicht erlaubt.');
          }}
        >
          Ans Eintragen der Anwesenheit erinnern
          <span className="switch" aria-hidden="true" />
        </button>
        <SelectField
          label="Wochentag"
          value={String(s.serviceWeekday)}
          options={WEEKDAYS}
          onChange={(v) => patch({ serviceWeekday: Number(v) })}
        />
        <TimeField label="Beginn im Sommerhalbjahr (Ostern bis Herbstferien)" value={s.serviceTimeSeason} onChange={(v) => patch({ serviceTimeSeason: v })} />
        <TimeField label="Beginn im Winterhalbjahr" value={s.serviceTimeOffSeason} onChange={(v) => patch({ serviceTimeOffSeason: v })} />
        <SelectField
          label="Erinnerung"
          value={String(s.serviceReminderLead)}
          options={LEADS}
          onChange={(v) => patch({ serviceReminderLead: Number(v) })}
        />
        <SelectField label="Bundesland (Ferientermine)" value={s.serviceState} options={STATES} onChange={(v) => patch({ serviceState: v })} />
        <button className="toggle toggle--switch" aria-pressed={s.serviceSkipHolidays} onClick={() => patch({ serviceSkipHolidays: !s.serviceSkipHolidays })}>
          In den Schulferien nicht erinnern
          <span className="switch" aria-hidden="true" />
        </button>

        <p className="muted">
          {win.from && win.to
            ? `${year}: ${s.serviceTimeSeason} Uhr von ${formatDate(win.from)} (Ende Osterferien) bis ${formatDate(win.to)} (Beginn Herbstferien), im Winterhalbjahr ${s.serviceTimeOffSeason} Uhr.`
            : stale
              ? 'Noch keine Ferientermine – es gilt überall die Winterzeit. Bitte aktualisieren (Internet nötig).'
              : `Für ${year} sind nicht alle Ferientermine bekannt – es gilt die Winterzeit. Unter „Ferien von Hand“ eintragen.`}
        </p>
        <details className="acc" open={!win.from || !win.to}>
          <summary>Ferien von Hand</summary>
          <div className="stack" style={{ paddingBottom: 'var(--s-2)' }}>
        <DateField
          label={`Ende der Osterferien ${year}`}
          value={s.serviceSeasonFrom}
          clearable
          onChange={(v) => patch({ serviceSeasonFrom: v })}
        />
        <DateField
          label={`Beginn der Herbstferien ${year}`}
          value={s.serviceSeasonTo}
          clearable
          onChange={(v) => patch({ serviceSeasonTo: v })}
        />
        <Button onClick={() => void update()}>Ferientermine aktualisieren</Button>
        {cache && (
          <p className="muted" style={{ margin: 0 }}>Stand: {new Date(cache.fetchedAt).toLocaleDateString('de-DE')} ({cache.state}). Die App aktualisiert sich einmal pro Woche selbst.</p>
        )}
          </div>
        </details>
        {next.length > 0 && (
          <p className="muted">Nächste Dienste: {next.map((n) => `${formatDate(n.date)} ${n.start}`).join(' · ')}</p>
        )}
        {msg && (
          <p role="status" className="muted">
            {msg}
          </p>
        )}
      </div>
    </Card>
  );
}
