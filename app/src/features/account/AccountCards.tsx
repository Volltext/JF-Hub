import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/core/db/db';
import { unsyncedCount } from '@/core/db/wipe';
import { useAccount } from '@/core/account/account';
import { IS_WEB } from '@/core/env';
import { Button, Card } from '@/core/ui/components';
import { confirmDialog } from '@/core/ui/dialog';
import { loadSettings } from '@/core/settings/settings';
import { changePassword, isLoggedIn, listDevices, logout, refreshAccount, revokeDevice, revokeOtherDevices, type DeviceInfo } from '@/features/protokolle/auth';
import { syncNow } from '@/features/protokolle/sync';
import { useSyncStatus } from '@/features/protokolle/syncStatus';
import { AuthForm, MIN_PASSWORD } from './AuthForm';

const time = (ms: number) => new Date(ms).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });

/** Fragt nach, bevor nicht gesendete Änderungen beim Abmelden verloren gehen, und meldet ab. Liefert true, wenn abgemeldet wurde. */
export async function confirmAndLogout(): Promise<boolean> {
  await syncNow().catch(() => undefined);
  const dirty = await unsyncedCount();
  const msg = dirty
    ? `${dirty} Änderung(en) konnten nicht an den Server gesendet werden und gehen beim Abmelden verloren.`
    : 'Beim Abmelden werden die Daten dieses Geräts entfernt. Sie liegen weiter auf dem Server und kommen bei der nächsten Anmeldung zurück.';
  if (!(await confirmDialog(msg, { title: 'Abmelden?', confirmLabel: 'Abmelden', danger: dirty > 0 }))) return false;
  await logout();
  return true;
}

/** Anmeldung am Server und Abgleich. Ohne Anmeldung zeigt sie die Anmeldemaske (in der App; im Browser ist man immer angemeldet). */
export function ConnectionCard() {
  const account = useAccount();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const { state, lastSyncAt, message, counts } = useSyncStatus();
  const local = useLiveQuery(
    async () => ({
      protocols: await db.protokolle.filter((p) => p.deleted === 0).count(),
      records: (await db.members.count()) + (await db.sessions.count()) + (await db.tasks.count()),
    }),
    [],
  );

  useEffect(() => {
    void isLoggedIn().then(setLoggedIn);
    void loadSettings().then((s) => setUrl(IS_WEB ? location.origin : s.protocolServerUrl));
  }, [state]);

  useEffect(() => {
    if (loggedIn) void refreshAccount();
  }, [loggedIn]);

  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setMsg('');
    try {
      setMsg((await fn()) ?? '');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  }

  if (loggedIn === null) return null;

  const status =
    state === 'auth'
      ? 'Anmeldung abgelaufen – bitte neu anmelden.'
      : state === 'offline'
        ? 'Server nicht erreichbar (Änderungen werden später abgeglichen).'
        : state === 'error'
          ? `Fehler: ${message}`
          : lastSyncAt
            ? `Zuletzt abgeglichen um ${new Date(lastSyncAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.`
            : 'Angemeldet.';

  if (!loggedIn) {
    return (
      <Card title="Beim Server anmelden">
        <div className="stack">
          <p className="muted">
            Mit einem Konto auf deinem JF-Hub-Server sind Protokolle, Dienste und Aufgaben auf allen Geräten verfügbar. Das Konto legt ein Admin an – du bekommst einen
            Einladungslink oder einen Code.
          </p>
          <AuthForm onDone={() => void syncNow().then(() => setLoggedIn(true))} />
        </div>
      </Card>
    );
  }

  return (
    <Card title={IS_WEB ? 'Konto' : 'Server & Konto'}>
      <div className="stack">
        <p>
          Angemeldet als <strong>{account?.displayName ?? '…'}</strong>
          {account && <span className="muted"> ({account.username}{account.role === 'admin' ? ', Admin' : ''})</span>}
        </p>
        <p className="muted">{status}</p>
        <p className="muted">
          Auf diesem Gerät: {local?.protocols ?? 0} Protokolle, {local?.records ?? 0} Mitglieder/Dienste/Aufgaben.
          {counts && ` Für dich auf dem Server: ${counts.protocols} Protokolle, ${counts.records} Mitglieder/Dienste/Aufgaben.`}
        </p>
        <Button
          disabled={busy || state === 'syncing'}
          onClick={() =>
            run(async () => {
              const r = await syncNow();
              return r ? `Abgeglichen: ${r.pushed} gesendet, ${r.pulled} empfangen.` : undefined;
            })
          }
        >
          Jetzt abgleichen
        </Button>
        <Button
          disabled={busy || state === 'syncing'}
          onClick={() =>
            run(async () => {
              const r = await syncNow({ full: true });
              return r ? `Alles neu abgeglichen: ${r.pulled} empfangen, ${r.reuploaded} fehlende erneut gesendet.` : undefined;
            })
          }
        >
          Alles neu abgleichen
        </Button>
        {account?.role === 'admin' && <Button onClick={() => window.open(`${url.replace(/\/+$/, '')}/admin/`, '_blank', 'noopener')}>Server-Verwaltung öffnen</Button>}
        <Button
          variant="danger"
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (await confirmAndLogout()) setLoggedIn(false);
            })
          }
        >
          Abmelden
        </Button>
        {msg && (
          <p role="status" className="muted">
            {msg}
          </p>
        )}
      </div>
    </Card>
  );
}

/** Eigenes Passwort ändern (die anderen Geräte werden dabei abgemeldet). */
export function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const ok = !!current && next.length >= MIN_PASSWORD && next === repeat;

  async function submit() {
    setBusy(true);
    setMsg('');
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setRepeat('');
      setMsg('Passwort geändert. Deine anderen Geräte wurden abgemeldet.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Passwort ändern">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>Aktuelles Passwort</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="field">
          <span>Neues Passwort (mind. {MIN_PASSWORD} Zeichen)</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="field">
          <span>Neues Passwort wiederholen</span>
          <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </label>
        {repeat && repeat !== next && <p className="muted">Die Passwörter stimmen nicht überein.</p>}
        <Button variant="primary" type="submit" disabled={busy || !ok}>
          Passwort ändern
        </Button>
        {msg && (
          <p role="status" className="muted">
            {msg}
          </p>
        )}
      </form>
    </Card>
  );
}

/** Geräte, auf denen dieses Konto angemeldet ist; verlorene lassen sich abmelden. */
export function DevicesCard() {
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => {
    listDevices()
      .then((d) => {
        setDevices(d);
        setMsg('');
      })
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : 'Fehler'));
  }, []);
  useEffect(load, [load]);

  if (!devices) return msg ? <Card title="Meine Geräte"><p className="muted">{msg}</p></Card> : null;
  const others = devices.filter((d) => !d.current).length;
  return (
    <Card title="Meine Geräte">
      <div className="stack">
        <div className="list">
          {devices.map((d) => (
            <div key={d.id} className="item" style={{ cursor: 'default' }}>
              <div className="item__main">
                <div className="item__title">
                  {d.device}
                  {d.current && <span className="chip" style={{ marginLeft: 8 }}>dieses Gerät</span>}
                </div>
                <div className="item__sub">Zuletzt aktiv {time(d.lastUsedAt)}</div>
              </div>
              {!d.current && (
                <Button
                  variant="danger"
                  onClick={async () => {
                    await revokeDevice(d.id);
                    load();
                  }}
                >
                  Abmelden
                </Button>
              )}
            </div>
          ))}
        </div>
        {others > 0 && (
          <Button
            variant="danger"
            onClick={async () => {
              if (!(await confirmDialog(`${others} andere(s) Gerät(e) müssen sich danach neu anmelden.`, { title: 'Alle anderen abmelden?', confirmLabel: 'Abmelden', danger: true }))) return;
              await revokeOtherDevices();
              load();
            }}
          >
            Alle anderen Geräte abmelden
          </Button>
        )}
        {msg && <p className="muted">{msg}</p>}
      </div>
    </Card>
  );
}
