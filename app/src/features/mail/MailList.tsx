import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Inbox, Paperclip, PenSquare, RefreshCw, Settings } from 'lucide-react';
import { Button, EmptyState, Page } from '@/core/ui/components';
import { SelectField } from '@/core/ui/pickers';
import { mailApi, type MailAccount, type MailFolder, type MailSummary } from './api';
import { formatDateTime, shortAddress } from './compose';

/** Heutige Mails mit Uhrzeit, ältere mit Datum. */
function when(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatDateTime(iso).split(', ')[1] ?? '';
  return formatDateTime(iso).split(', ')[0] ?? '';
}

const folderLabel = (f: MailFolder) => `${f.name}${f.unseen > 0 ? ` (${f.unseen})` : ''}`;

export function MailList({ account }: { account: MailAccount }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const folder = params.get('ordner') ?? 'INBOX';
  const query = params.get('suche') ?? '';
  const [search, setSearch] = useState(query);
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [items, setItems] = useState<MailSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const run = useRef(0);

  const load = useCallback(
    async (page: number, append: boolean) => {
      const mine = ++run.current;
      setLoading(true);
      setError('');
      try {
        const res = await mailApi.list(folder, page, query);
        if (mine !== run.current) return;
        setItems((old) => (append ? [...old, ...res.items.filter((m) => !old.some((o) => o.uid === m.uid))] : res.items));
        setTotal(res.total);
        setPageSize(res.pageSize);
      } catch (e) {
        if (mine === run.current) setError(e instanceof Error ? e.message : 'Fehler');
      } finally {
        if (mine === run.current) setLoading(false);
      }
    },
    [folder, query],
  );

  const loadFolders = useCallback(() => {
    void mailApi.folders().then(setFolders, () => undefined);
  }, []);

  useEffect(() => {
    void load(1, false);
  }, [load]);
  useEffect(() => {
    loadFolders();
  }, [loadFolders, folder]);

  // Beim Zurückkehren in die App den Posteingang auffrischen.
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === 'visible' && !query) void load(1, false);
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [load, query]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const current = folders.find((f) => f.path === folder);
  const options = folders.length ? folders.map((f) => ({ value: f.path, label: folderLabel(f) })) : [{ value: 'INBOX', label: 'Posteingang' }];
  const sent = current?.special === 'sent' || current?.special === 'drafts';
  const more = items.length < total;

  return (
    <Page
      title={current?.name ?? 'Posteingang'}
      sub={account.email}
      fromMore
      actions={
        <>
          <button type="button" className="icon-btn" aria-label="Neu laden" title="Neu laden" onClick={() => void load(1, false)} disabled={loading}>
            <RefreshCw size={20} />
          </button>
          <Link to="/mail/konto" className="icon-btn" aria-label="Postfach-Einstellungen" title="Postfach-Einstellungen">
            <Settings size={20} />
          </Link>
        </>
      }
    >
      {account.lastError && <p role="alert" className="proto-error">Benachrichtigungen: {account.lastError}</p>}
      <SelectField label="Ordner" value={folder} options={options} onChange={(v) => setParam('ordner', v === 'INBOX' ? '' : v)} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setParam('suche', search.trim());
        }}
      >
        <input className="search" type="search" placeholder="Suchen (Betreff, Absender)" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Mails suchen" />
      </form>

      {error && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && <EmptyState icon={Inbox} title={query ? 'Nichts gefunden' : 'Keine Mails'}>{query ? 'Zu dieser Suche gibt es keine Mails in diesem Ordner.' : 'In diesem Ordner liegen keine Mails.'}</EmptyState>}

      <div className="list">
        {items.map((m) => (
          <Link key={m.uid} to={`/mail/m/${encodeURIComponent(folder)}/${m.uid}`} className={`item item--top mail-row${m.seen ? '' : ' mail-row--unread'}`}>
            <div className="item__main">
              <div className="mail-row__head">
                <span className="item__title mail-row__from">{sent ? `An ${shortAddress(m.to[0])}` : shortAddress(m.from)}</span>
                <span className="muted mail-row__when">
                  {m.hasAttachments && <Paperclip size={14} aria-label="Mit Anhang" />} {when(m.date)}
                </span>
              </div>
              <div className="mail-row__subject">{m.subject || '(ohne Betreff)'}</div>
            </div>
          </Link>
        ))}
      </div>
      {loading && <p className="muted" role="status">Lädt …</p>}
      {!loading && more && (
        <Button onClick={() => void load(Math.floor(items.length / pageSize) + 1, true)}>Ältere Mails laden ({total - items.length})</Button>
      )}

      <button className="fab" aria-label="Neue Mail schreiben" onClick={() => navigate('/mail/neu')}>
        <PenSquare />
      </button>
    </Page>
  );
}
