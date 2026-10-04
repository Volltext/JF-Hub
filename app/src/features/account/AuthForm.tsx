import { useEffect, useState, type FormEvent } from 'react';
import { Button, Segmented } from '@/core/ui/components';
import { IS_WEB } from '@/core/env';
import { loadSettings } from '@/core/settings/settings';
import { acceptInvite, login } from '@/features/protokolle/auth';

export const MIN_PASSWORD = 10;

export type AuthMode = 'login' | 'invite';

/** Daten aus einem Einladungslink (`/#/einladung?u=anna&c=ABCD-…`). */
export function inviteFromHash(hash = window.location.hash): { username: string; code: string } | null {
  const m = /^#\/?einladung\?(.*)$/.exec(hash);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  return { username: q.get('u') ?? '', code: q.get('c') ?? '' };
}

/**
 * Anmelden oder Einladung einlösen. In der App kommt die Server-Adresse dazu,
 * im Browser ist es immer der Server, der die Seite ausgeliefert hat.
 */
export function AuthForm({ onDone, initialMode = 'login', invite }: { onDone: () => void; initialMode?: AuthMode; invite?: { username: string; code: string } | null }) {
  const [mode, setMode] = useState<AuthMode>(invite ? 'invite' : initialMode);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState(invite?.username ?? '');
  const [code, setCode] = useState(invite?.code ?? '');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!IS_WEB) void loadSettings().then((s) => setUrl(s.protocolServerUrl));
  }, []);

  const tooShort = mode === 'invite' && password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = mode === 'invite' && repeat.length > 0 && repeat !== password;
  const ready =
    !!username.trim() && !!password && (IS_WEB || !!url.trim()) && (mode === 'login' || (!!code.trim() && password.length >= MIN_PASSWORD && repeat === password));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(url, username, password);
      else await acceptInvite(url, username, code, password);
      setPassword('');
      setRepeat('');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <Segmented<AuthMode>
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError('');
        }}
        options={[
          { value: 'login', label: 'Anmelden' },
          { value: 'invite', label: 'Einladung einlösen' },
        ]}
      />
      {!IS_WEB && (
        <label className="field">
          <span>Server-Adresse</span>
          <input inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="jfhub.deine-domain.de" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>Benutzername</span>
        <input autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      {mode === 'invite' && (
        <label className="field">
          <span>Einladungscode</span>
          <input autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" placeholder="XXXX-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>{mode === 'invite' ? `Dein neues Passwort (mind. ${MIN_PASSWORD} Zeichen)` : 'Passwort'}</span>
        <input type="password" autoComplete={mode === 'invite' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {mode === 'invite' && (
        <label className="field">
          <span>Passwort wiederholen</span>
          <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </label>
      )}
      {tooShort && <p className="muted">Das Passwort braucht mindestens {MIN_PASSWORD} Zeichen.</p>}
      {mismatch && <p className="muted">Die Passwörter stimmen nicht überein.</p>}
      <Button variant="primary" type="submit" disabled={busy || !ready}>
        {mode === 'invite' ? 'Passwort festlegen und anmelden' : 'Anmelden'}
      </Button>
      {error && (
        <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>
          {error}
        </p>
      )}
    </form>
  );
}
