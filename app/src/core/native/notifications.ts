import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Reminder } from '@/core/domain/tasks';
import { enablePush, pushEnabled, syncWebReminders } from '@/core/push/webPush';

export type ReminderKind = 'task' | 'service';

const CHANNELS: Record<ReminderKind, { id: string; name: string; importance: 1 | 2 | 3 | 4 | 5 }> = {
  task: { id: 'tasks', name: 'Aufgaben', importance: 4 },
  service: { id: 'service', name: 'Dienst-Erinnerung', importance: 5 },
};

/**
 * Fragt die Berechtigung an, falls nötig. Liefert true, wenn Benachrichtigungen erlaubt sind.
 * Im Browser bedeutet das Web-Push: Erlaubnis einholen und dieses Gerät am Server anmelden (aus einer Nutzeraktion aufrufen).
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return (await pushEnabled()) || (await enablePush().catch(() => false));
  let { display } = await LocalNotifications.checkPermissions();
  if (display === 'prompt' || display === 'prompt-with-rationale')
    display = (await LocalNotifications.requestPermissions()).display;
  return display === 'granted';
}

/**
 * Ersetzt alle geplanten Erinnerungen der Art `kind` durch die übergebenen; Erinnerungen anderer Arten
 * bleiben unberührt. Android: lokale Benachrichtigungen; Browser: Web-Push vom Server (nur wenn dieses Gerät dafür angemeldet ist);
 * ohne Berechtigung passiert nichts.
 */
export async function syncReminders(reminders: Reminder[], kind: ReminderKind = 'task'): Promise<void> {
  if (!Capacitor.isNativePlatform()) return syncWebReminders(reminders, kind);
  const pending = await LocalNotifications.getPending();
  // Ältere Aufgaben-Erinnerungen tragen kein `extra` und zählen als 'task'.
  const own = pending.notifications.filter((n) => ((n.extra as { kind?: ReminderKind } | undefined)?.kind ?? 'task') === kind);
  if (own.length) await LocalNotifications.cancel({ notifications: own.map(({ id }) => ({ id })) });
  if (!reminders.length || !(await ensureNotificationPermission())) return;
  const channel = CHANNELS[kind];
  await LocalNotifications.createChannel(channel);
  await LocalNotifications.schedule({
    notifications: reminders.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      channelId: channel.id,
      extra: { kind },
      schedule: { at: r.at, allowWhileIdle: true },
    })),
  });
}

/** Ruft `onService` auf, wenn der Nutzer eine Dienst-Erinnerung antippt (auch beim Kaltstart der App). */
export function onServiceReminderTapped(onService: () => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  const handle = LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
    if ((e.notification.extra as { kind?: ReminderKind } | undefined)?.kind === 'service') onService();
  });
  return () => void handle.then((h) => h.remove());
}
