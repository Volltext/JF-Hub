import { useEffect } from 'react';
import { App as CapApp } from '@capacitor/app';
import { CHANGED_EVENT } from '@/core/db/outbox';
import { refreshAccount } from './auth';
import { scheduleSync, syncNow } from './sync';

/** Löst den Abgleich beim Start, bei Netzrückkehr, beim Zurückkehren in die App und regelmäßig aus. */
export function SyncHost() {
  useEffect(() => {
    const run = () => {
      void syncNow();
    };
    run();
    void refreshAccount(); // Name und Rolle des Kontos (auch nach einem Update von 1.x ohne neue Anmeldung)
    window.addEventListener('online', run);
    const onChanged = () => scheduleSync();
    window.addEventListener(CHANGED_EVENT, onChanged);
    const onVisible = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onVisible);
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => isActive && run());
    const interval = setInterval(() => document.visibilityState === 'visible' && run(), 60_000);
    return () => {
      window.removeEventListener('online', run);
      window.removeEventListener(CHANGED_EVENT, onChanged);
      document.removeEventListener('visibilitychange', onVisible);
      void sub.then((h) => h.remove());
      clearInterval(interval);
    };
  }, []);
  return null;
}
