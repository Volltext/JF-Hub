import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { Button, EmptyState, Page } from '@/core/ui/components';
import { IS_DEMO } from '@/core/env';
import { Compose } from './Compose';
import { MailList } from './MailList';
import { MailSetup } from './MailSetup';
import { MailView } from './MailView';
import { useMailAccount } from './useMailAccount';
import './mail.css';

/** E-Mail: Postfach verbinden, Mails lesen und schreiben. Optional: Ohne Postfach erscheint nur die Einrichtung. */
export function MailPage() {
  if (IS_DEMO) {
    return (
      <Page title="E-Mail" fromMore>
        <EmptyState icon={Mail} title="In der Demo nicht verfügbar">
          E-Mail gibt es nur in einer eigenen Installation: Der JF-Hub-Server verbindet sich dann mit deinem Postfach.
        </EmptyState>
      </Page>
    );
  }
  return <Connected />;
}

function Connected() {
  const { account, error, reload } = useMailAccount();
  const navigate = useNavigate();
  const sent = (useLocation().state as { sent?: boolean } | null)?.sent;

  if (error && account === undefined) {
    return (
      <Page title="E-Mail" fromMore>
        <EmptyState icon={Mail} title="E-Mail ist gerade nicht erreichbar" action={<Button onClick={() => void reload()}>Noch einmal versuchen</Button>}>
          {error}
        </EmptyState>
      </Page>
    );
  }
  if (account === undefined) return null;

  const saved = async () => {
    await reload();
    navigate('/mail', { replace: true });
  };

  return (
    <Routes>
      <Route index element={account ? <><MailNotice show={!!sent} /><MailList account={account} /></> : <MailSetup account={null} onSaved={() => void saved()} />} />
      <Route path="konto" element={<MailSetup account={account} onSaved={() => void saved()} />} />
      {account && <Route path="m/:folder/:uid" element={<MailView account={account} />} />}
      {account && <Route path="neu" element={<Compose account={account} />} />}
      <Route path="*" element={<Navigate to="/mail" replace />} />
    </Routes>
  );
}

function MailNotice({ show }: { show: boolean }) {
  return show ? (
    <p role="status" className="mail-notice">
      Mail gesendet.
    </p>
  ) : null;
}
