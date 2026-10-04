import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { db } from '@/core/db/db';
import { loadSettings } from '@/core/settings/settings';
import { planReminders, type Reminder } from '@/core/domain/tasks';
import { serviceNotificationId, upcomingServices } from '@/core/domain/serviceSchedule';
import { syncReminders, onServiceReminderTapped } from '@/core/native/notifications';
import { refreshHolidaysIfStale } from '@/core/holidays/holidays';
import { useServiceConfig } from '@/core/holidays/useServiceConfig';
import { formatDate } from '@/core/domain/format';

/** So viele Dienste werden im Voraus eingeplant; bei jedem Öffnen der App wird nachgeplant. */
const SERVICES_AHEAD = 10;

/** Hält die geplanten Android-Erinnerungen synchron mit Aufgaben, Dienst-Rhythmus und Einstellungen. */
export function ReminderSync() {
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const settings = useLiveQuery(loadSettings, []);
  const service = useServiceConfig();
  const navigate = useNavigate();
  // Wird beim Zurückkehren in die App erhöht, damit `new Date()` neu bewertet wird.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) setTick((t) => t + 1);
    });
    return () => void sub.then((h) => h.remove());
  }, []);

  useEffect(() => onServiceReminderTapped(() => navigate('/dienste', { state: { create: true } })), [navigate]);

  useEffect(() => {
    if (!tasks || !settings) return;
    const reminders = settings.notificationsEnabled
      ? planReminders(tasks, settings.taskNotifyTime, new Date())
      : [];
    void syncReminders(reminders, 'task').catch(() => {
      /* Benachrichtigungen sind optional; Fehler dürfen die App nicht stören. */
    });
  }, [tasks, settings, tick]);

  const state = settings?.serviceState;
  useEffect(() => {
    if (state) void refreshHolidaysIfStale(state);
  }, [state, tick]);

  useEffect(() => {
    if (!service) return;
    const { settings: s, config } = service;
    const reminders: Reminder[] = s.serviceReminderEnabled
      ? upcomingServices(new Date(), config, SERVICES_AHEAD).map((slot) => ({
          id: serviceNotificationId(slot.date),
          title: 'Dienst gleich',
          body: `${formatDate(slot.date, true)}, ${slot.start} Uhr – Teilnehmer eintragen`,
          at: slot.remindAt,
        }))
      : [];
    void syncReminders(reminders, 'service').catch(() => {
      /* siehe oben */
    });
  }, [service, tick]);

  return null;
}
