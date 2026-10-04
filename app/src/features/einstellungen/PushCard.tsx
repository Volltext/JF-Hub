import { useEffect, useState } from 'react';
import { Button, Card } from '@/core/ui/components';
import { IS_WEB } from '@/core/env';
import { enablePush, pushEnabled, pushUnavailableReason, removePushSubscription } from '@/core/push/webPush';
import { loadConn, request } from '@/features/protokolle/http';
import { currentSubscription } from '@/core/push/webPush';

/** Benachrichtigungen im Browser (Web-Push): der Server erinnert auch, wenn die App geschlossen ist. Nur im Browser-Build. */
export function PushCard() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const reason = IS_WEB ? pushUnavailableReason() : null;

  useEffect(() => {
    void pushEnabled().then(setOn);
  }, []);

  if (!IS_WEB) return null;

  async function toggle() {
    setBusy(true);
    setMsg('');
    try {
      if (on) {
        await removePushSubscription();
        setOn(false);
        setMsg('Benachrichtigungen sind auf diesem Gerät aus.');
      } else {
        const ok = await enablePush();
        setOn(ok);
        setMsg(ok ? 'Benachrichtigungen sind auf diesem Gerät an.' : (pushUnavailableReason() ?? 'Die Erlaubnis wurde nicht erteilt.'));
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg('');
    try {
      const sub = await currentSubscription();
      if (!sub) throw new Error('Dieses Gerät ist nicht angemeldet.');
      await request(await loadConn(), 'POST', '/api/push/test', { endpoint: sub.endpoint });
      setMsg('Test gesendet – die Benachrichtigung sollte gleich erscheinen.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Benachrichtigungen auf diesem Gerät">
      <div className="stack">
        <p className="muted">
          Der Server schickt Erinnerungen (Dienst, fällige Aufgaben) auch dann, wenn diese Seite geschlossen ist. Das gilt nur für dieses Gerät und diesen Browser.
        </p>
        {reason ? (
          <p role="status">{reason}</p>
        ) : (
          <>
            <button className="toggle" aria-pressed={!!on} disabled={busy || on === null} onClick={() => void toggle()}>
              <span className="toggle__box">{on && '✓'}</span> Erinnerungen als Benachrichtigung zeigen
            </button>
            {on && (
              <Button disabled={busy} onClick={() => void test()}>
                Testbenachrichtigung senden
              </Button>
            )}
          </>
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
