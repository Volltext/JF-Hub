import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { Button, Card, EmptyState, Page } from '@/core/ui/components';
import { SelectField } from '@/core/ui/pickers';
import { confirmDialog } from '@/core/ui/dialog';
import { IS_WEB } from '@/core/env';
import { pushEnabled } from '@/core/push/webPush';
import { mailApi, type MailAccount } from './api';
import { CUSTOM, PROVIDERS, guessProvider, providerById, providerFor, type Provider } from './providers';

const OPTIONS = [...PROVIDERS, CUSTOM].map((p) => ({ value: p.id, label: p.label }));

interface Form {
  email: string;
  displayName: string;
  username: string;
  password: string;
  provider: string;
  imapHost: string;
  imapPort: string;
  smtpHost: string;
  smtpPort: string;
  notify: boolean;
}

function initial(account: MailAccount | null | undefined): Form {
  if (!account) return { email: '', displayName: '', username: '', password: '', provider: 'gmx', imapHost: '', imapPort: '993', smtpHost: '', smtpPort: '587', notify: true };
  return {
    email: account.email,
    displayName: account.displayName,
    username: account.username === account.email ? '' : account.username,
    password: '',
    provider: providerFor(account.imapHost, account.smtpHost).id,
    imapHost: account.imapHost,
    imapPort: String(account.imapPort),
    smtpHost: account.smtpHost,
    smtpPort: String(account.smtpPort),
    notify: account.notify,
  };
}

/** Postfach verbinden oder ändern. Der Server prüft die Zugangsdaten sofort beim Mail-Server und speichert sie nur, wenn sie stimmen. */
export function MailSetup({ account, onSaved }: { account: MailAccount | null | undefined; onSaved: () => void }) {
  const editing = !!account;
  const [f, setF] = useState<Form>(() => initial(account));
  const [manualProvider, setManualProvider] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  useEffect(() => {
    void pushEnabled().then(setPushOn);
  }, []);

  const provider: Provider = providerById(f.provider);
  const custom = f.provider === CUSTOM.id;
  const patch = (p: Partial<Form>) => setF((old) => ({ ...old, ...p }));

  function setEmail(email: string) {
    const guess = manualProvider ? undefined : guessProvider(email);
    patch({ email, ...(guess ? { provider: guess.id } : {}) });
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const p = custom ? { imapHost: f.imapHost, imapPort: Number(f.imapPort), smtpHost: f.smtpHost, smtpPort: Number(f.smtpPort) } : { imapHost: provider.imapHost, imapPort: provider.imapPort, smtpHost: provider.smtpHost, smtpPort: provider.smtpPort };
      await mailApi.saveAccount({ email: f.email.trim(), displayName: f.displayName.trim(), username: f.username.trim(), password: f.password, notify: f.notify, ...p });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!(await confirmDialog('Das Postfach von JF Hub trennen? Die Zugangsdaten werden vom Server gelöscht. Deine Mails bleiben beim Anbieter unverändert.', { title: 'Postfach trennen', confirmLabel: 'Trennen', danger: true }))) return;
    setBusy(true);
    try {
      await mailApi.removeAccount();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
      setBusy(false);
    }
  }

  const ready = f.email.includes('@') && (editing || f.password) && (!custom || (f.imapHost && f.smtpHost));

  return (
    <Page title={editing ? 'Postfach' : 'E-Mail verbinden'} sub={editing ? account!.email : 'Optional: Mails in JF Hub lesen und schreiben'} back={editing ? { to: '/mail', label: 'Posteingang' } : undefined} fromMore={!editing}>
      {!editing && (
        <EmptyState icon={Mail} title="Dein Postfach in JF Hub">
          Verbinde dein Postfach (zum Beispiel GMX), um Mails zu lesen und zu schreiben, Anhänge ins Protokoll zu übernehmen, Protokolle als PDF zu verschicken und aus Mails Aufgaben zu machen. Das Postfach ist nur für dich sichtbar.
        </EmptyState>
      )}
      <Card title="Zugangsdaten">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !busy) void save();
          }}
        >
          <label className="field">
            <span>E-Mail-Adresse</span>
            <input type="email" inputMode="email" autoComplete="off" autoCapitalize="none" value={f.email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmx.de" />
          </label>
          <SelectField
            label="Anbieter"
            value={f.provider}
            options={OPTIONS}
            onChange={(v) => {
              setManualProvider(true);
              patch({ provider: v });
            }}
          />
          <label className="field">
            <span>{editing ? 'Passwort (leer lassen = unverändert)' : 'Passwort'}</span>
            <input type="password" autoComplete="new-password" value={f.password} onChange={(e) => patch({ password: e.target.value })} />
          </label>
          <p className="muted">{provider.hint}</p>
          <label className="field">
            <span>Absendername (optional)</span>
            <input autoComplete="off" value={f.displayName} onChange={(e) => patch({ displayName: e.target.value })} placeholder="Wie dein Name beim Empfänger erscheint" />
          </label>
          {custom && (
            <>
              <label className="field">
                <span>IMAP-Server (Posteingang)</span>
                <input autoCapitalize="none" value={f.imapHost} onChange={(e) => patch({ imapHost: e.target.value })} placeholder="imap.example.org" />
              </label>
              <label className="field">
                <span>IMAP-Port</span>
                <input inputMode="numeric" value={f.imapPort} onChange={(e) => patch({ imapPort: e.target.value })} />
              </label>
              <label className="field">
                <span>SMTP-Server (Postausgang)</span>
                <input autoCapitalize="none" value={f.smtpHost} onChange={(e) => patch({ smtpHost: e.target.value })} placeholder="smtp.example.org" />
              </label>
              <label className="field">
                <span>SMTP-Port</span>
                <input inputMode="numeric" value={f.smtpPort} onChange={(e) => patch({ smtpPort: e.target.value })} />
              </label>
              <label className="field">
                <span>Benutzername (leer = E-Mail-Adresse)</span>
                <input autoCapitalize="none" autoComplete="off" value={f.username} onChange={(e) => patch({ username: e.target.value })} />
              </label>
            </>
          )}
          <button type="button" className="toggle" aria-pressed={f.notify} onClick={() => patch({ notify: !f.notify })}>
            <span className="toggle__box">{f.notify && '✓'}</span> Bei neuen Mails benachrichtigen
          </button>
          {f.notify && (
            <p className="muted">
              {!IS_WEB
                ? 'Benachrichtigungen bei neuen Mails kommen in der Browser-App (PWA). Die Android-App zeigt sie nicht.'
                : pushOn
                  ? 'Dieses Gerät ist für Benachrichtigungen angemeldet. Der Server prüft etwa alle 2 Minuten auf neue Mails. Absender und Betreff stehen in der Benachrichtigung.'
                  : 'Dafür müssen Benachrichtigungen auf diesem Gerät an sein (Einstellungen → Erinnerungen). Absender und Betreff stehen in der Benachrichtigung.'}
              {IS_WEB && !pushOn && (
                <>
                  {' '}
                  <Link to="/einstellungen/erinnerungen">Jetzt einschalten</Link>
                </>
              )}
            </p>
          )}
          {error && (
            <p role="alert" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}
          <Button variant="primary" type="submit" disabled={!ready || busy}>
            {busy ? 'Verbindung wird geprüft …' : editing ? 'Speichern' : 'Verbinden'}
          </Button>
          {editing && (
            <Button variant="danger" type="button" disabled={busy} onClick={() => void disconnect()}>
              Postfach trennen
            </Button>
          )}
        </form>
      </Card>
      <Card title="Gut zu wissen">
        <ul className="muted mail-notes">
          <li>Das Passwort wird auf dem JF-Hub-Server verschlüsselt gespeichert und nie an die App zurückgegeben.</li>
          <li>Mails bleiben bei deinem Anbieter. JF Hub speichert sie nicht und zeigt sie nur mit Verbindung zum Server.</li>
          <li>HTML-Mails erscheinen als reiner Text: Bilder aus dem Netz werden nicht nachgeladen, Links zeigen ihre Adresse.</li>
          <li>Jeder Betreuer verbindet sein eigenes Postfach. Andere Betreuer sehen deine Mails nicht. Wer den Server betreibt, hat technisch Zugriff auf dessen Daten und den Schlüssel; nimm daher kein Postfach, das du dem Betreiber nicht anvertrauen willst.</li>
        </ul>
      </Card>
    </Page>
  );
}
