import { useEffect, useState } from 'react';
import { loadSettings } from '@/core/settings/settings';
import { applyTheme } from '@/core/ui/theme';
import { Card } from '@/core/ui/components';
import { AuthForm, inviteFromHash } from '@/features/account/AuthForm';
import { DemoBanner, useDemoInfo } from '@/features/account/demo';
import { isLoggedIn } from '@/features/protokolle/auth';
import { useSyncStatus } from '@/features/protokolle/syncStatus';
import { AppFrame } from './AppFrame';

type Phase = 'boot' | 'login' | 'open';

/**
 * Browser-Variante (PWA), vom Server selbst ausgeliefert: die ganze App hinter der Anmeldung.
 * Ein Einladungslink (`/#/einladung?u=…&c=…`) öffnet direkt die Passwortvergabe.
 */
export function WebApp() {
  const [phase, setPhase] = useState<Phase>('boot');
  const syncState = useSyncStatus((s) => s.state);
  const [invite] = useState(() => inviteFromHash());
  const demo = useDemoInfo();

  useEffect(() => {
    document.body.classList.add('web');
    void (async () => {
      applyTheme((await loadSettings()).theme);
      setPhase((await isLoggedIn()) ? 'open' : 'login');
    })();
  }, []);

  // Der Server hat die Sitzung beendet (abgemeldet, gesperrt, Passwort geändert).
  useEffect(() => {
    if (syncState === 'auth') setPhase('login');
  }, [syncState]);

  if (phase === 'boot') return null;
  if (phase === 'login') {
    return (
      <main className="web-login stack">
        <header className="web-login__brand">
          <img className="side__logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          <h1>JF Hub</h1>
        </header>
        <p className="web-login__lead">{invite ? 'Willkommen! Leg dein Passwort fest, dann geht es los.' : 'Die Zentrale für eure Betreuer: Dienste, Protokolle, Aufgaben und Wettkampf.'}</p>
        <Card>
          <AuthForm
            invite={invite}
            onDone={() => {
              // Den Einladungscode nicht in der Adresszeile stehen lassen.
              window.history.replaceState(null, '', '/#/');
              setPhase('open');
            }}
          />
        </Card>
      </main>
    );
  }
  // Immer im selben Rahmen, damit die App nicht neu startet, wenn die Demo-Auskunft nachträglich eintrifft.
  return (
    <div className="web-frame">
      {demo && <DemoBanner info={demo} />}
      <div className="web-frame__app">
        <AppFrame />
      </div>
    </div>
  );
}
