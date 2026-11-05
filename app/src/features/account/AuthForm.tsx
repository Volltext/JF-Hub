import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Segmented } from '@/core/ui/components';
import { IS_WEB } from '@/core/env';
import { loadSettings } from '@/core/settings/settings';
import { acceptInvite, login } from '@/features/protokolle/auth';
import { useDemoInfo, type DemoAccount } from './demo';

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
  const [show, setShow] = useState(false);
  const demo = useDemoInfo();

  useEffect(() => {
    if (!IS_WEB) void loadSettings().then((s) => setUrl(s.protocolServerUrl));
  }, []);

  const tooShort = mode === 'invite' && password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = mode === 'invite' && repeat.length > 0 && repeat !== password;
  const ready =
    !!username.trim() && !!password && (IS_WEB || !!url.trim()) && (mode === 'login' || (!!code.trim() && password.length >= MIN_PASSWORD && repeat === password));

  async function attempt(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setPassword('');
      setRepeat('');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void attempt(() => (mode === 'login' ? login(url, username, password) : acceptInvite(url, username, code, password)));
  }

  const demoLogin = (a: DemoAccount) => void attempt(() => login(url, a.username, a.password));

  return (
    <form className="stack" onSubmit={submit}>
      {demo && mode === 'login' && (
        <div className="demo-login stack">
          <p>
            <strong>Demo:</strong> Wähle einen Zugang und schau dich um. Alles ist erfunden und wird täglich um {demo.resetAt} Uhr zurückgesetzt.
          </p>
          {demo.accounts.map((a) => (
            <button key={a.username} type="button" className="demo-account" disabled={busy} onClick={() => demoLogin(a)}>
              <span className="demo-account__name">Als {a.displayName} anmelden</span>
              <span className="demo-account__hint">
                {a.hint} · Benutzer „{a.username}“
              </span>
            </button>
          ))}
          <p className="muted">Passwort für beide: {demo.accounts[0]?.password}</p>
        </div>
      )}
      <Segmented<AuthMode>
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError('');
        }}
        options={[
          { value: 'login', label: 'Anmelden' },
          { value: 'invite', label: 'Mit Einladung' },
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
      <div className="field">
        <label htmlFor="auth-password">{mode === 'invite' ? `Dein neues Passwort (mind. ${MIN_PASSWORD} Zeichen)` : 'Passwort'}</label>
        <div className="pw-field">
          <input
            id="auth-password"
            type={show ? 'text' : 'password'}
            autoComplete={mode === 'invite' ? 'new-password' : 'current-password'}
            value={password}
            aria-invalid={!!error || tooShort}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" className="pw-field__toggle" aria-label={show ? 'Passwort verbergen' : 'Passwort anzeigen'} aria-pressed={show} onClick={() => setShow(!show)}>
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>
      {mode === 'invite' && (
        <label className="field">
          <span>Passwort wiederholen</span>
          <input type={show ? 'text' : 'password'} autoComplete="new-password" value={repeat} aria-invalid={mismatch} onChange={(e) => setRepeat(e.target.value)} />
        </label>
      )}
      {tooShort && <p className="field__hint" style={{ margin: 0 }}>Noch {MIN_PASSWORD - password.length} Zeichen bis zur Mindestlänge.</p>}
      {mismatch && <p className="form-error">Die beiden Passwörter stimmen nicht überein.</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <Button variant="primary" type="submit" disabled={busy || !ready}>
        {busy ? 'Einen Moment …' : mode === 'invite' ? 'Passwort festlegen und anmelden' : 'Anmelden'}
      </Button>
      {mode === 'login' && <p className="field__hint auth-hint">Passwort vergessen? Dein Admin kann es in der Server-Verwaltung zurücksetzen.</p>}
      {mode === 'invite' && !invite && <p className="field__hint auth-hint">Benutzername und Code stehen in der Einladung, die du von deinem Admin bekommen hast.</p>}
    </form>
  );
}
