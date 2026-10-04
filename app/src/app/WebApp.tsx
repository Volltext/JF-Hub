import { useEffect, useState } from 'react';
import { loadSettings } from '@/core/settings/settings';
import { applyTheme } from '@/core/ui/theme';
import { Card } from '@/core/ui/components';
import { AuthForm, inviteFromHash } from '@/features/account/AuthForm';
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
      <div className="web-login stack">
        <div className="side__brand" style={{ justifyContent: 'center', paddingBottom: 'var(--s-3)' }}>
          <img className="side__logo" src="/favicon.svg" alt="" />
          JF Hub
        </div>
        <Card title={invite ? 'Willkommen – Passwort festlegen' : 'Anmelden'}>
          <AuthForm
            invite={invite}
            onDone={() => {
              // Den Einladungscode nicht in der Adresszeile stehen lassen.
              window.history.replaceState(null, '', '/#/');
              setPhase('open');
            }}
          />
        </Card>
      </div>
    );
  }
  return <AppFrame />;
}
