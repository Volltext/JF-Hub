import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronLeft, Download, FileText, Forward, ListPlus, MailOpen, Paperclip, Reply, ReplyAll, Trash2 } from 'lucide-react';
import { Button, Sheet } from '@/core/ui/components';
import { DateField } from '@/core/ui/pickers';
import { alertDialog, confirmDialog } from '@/core/ui/dialog';
import { formatBytes } from '@/features/attachments/limits';
import { taskRepo } from '@/core/db/repos';
import { mailApi, type MailAccount, type MailAttachment, type MailMessage } from './api';
import { createProtocolFromMail, placeAttachments, queueForProtocol, saveAttachment } from './actions';
import { addressList, buildForward, buildReply, formatDateTime, recipientSummary, shortAddress } from './compose';
import { ProtocolPicker } from './ProtocolPicker';
import { taskFromMail } from './toTask';

type Panel = null | { kind: 'task' } | { kind: 'protocol' } | { kind: 'pick'; attachments: MailAttachment[] };

export function MailView({ account }: { account: MailAccount }) {
  const { folder: folderParam = 'INBOX', uid: uidParam = '' } = useParams();
  const folder = decodeURIComponent(folderParam);
  const uid = Number(uidParam);
  const navigate = useNavigate();
  const [msg, setMsg] = useState<MailMessage | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setMsg(undefined);
    setError('');
    setShowAll(false);
    mailApi.get(folder, uid).then(
      (m) => alive && setMsg(m),
      (e) => {
        if (!alive) return;
        setMsg(null);
        setError(e instanceof Error ? e.message : 'Fehler');
      },
    );
    return () => {
      alive = false;
    };
  }, [folder, uid]);

  const back = { to: folder === 'INBOX' ? '/mail' : `/mail?ordner=${encodeURIComponent(folder)}`, label: 'Mails' };

  async function guarded(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  }

  if (msg === undefined) return <div className="page"><p className="muted" role="status">Lädt …</p></div>;
  if (msg === null)
    return (
      <div className="page">
        <Link to={back.to} className="back-link">
          <ChevronLeft size={18} /> {back.label}
        </Link>
        <p role="alert" style={{ color: 'var(--danger)' }}>{error || 'Diese Mail gibt es nicht mehr.'}</p>
      </div>
    );

  const reply = (all: boolean) => navigate('/mail/neu', { state: { draft: buildReply(msg, { all, me: account.email }) } });
  const forward = () => navigate('/mail/neu', { state: { draft: buildForward(msg), forwardOf: { folder, uid, attachments: msg.attachments } } });
  const remove = async () => {
    if (!(await confirmDialog('Diese Mail löschen? Sie landet im Papierkorb deines Postfachs.', { title: msg.subject || 'Mail löschen', confirmLabel: 'Löschen', danger: true }))) return;
    await guarded(async () => {
      await mailApi.remove(folder, uid);
      navigate(back.to, { replace: true });
    });
  };

  async function toProtocols(list: MailAttachment[], target: { id?: string }) {
    await guarded(async () => {
      const { placed, skipped } = await placeAttachments(folder, uid, list);
      if (target.id) {
        await queueForProtocol(target.id, placed);
        if (placed.length) navigate(`/protokolle/${target.id}`);
      }
      if (skipped.length) await alertDialog(`Nicht übernommen:\n${skipped.join('\n')}`, 'Anhänge');
      setPanel(null);
    });
  }

  return (
    <div className="page mail-view">
      <Link to={back.to} className="back-link">
        <ChevronLeft size={18} /> {back.label}
      </Link>
      <header className="mail-view__head">
        <h1 className="mail-view__subject">{msg.subject || '(ohne Betreff)'}</h1>
        <div className="mail-from">
          <span className="mail-from__who">
            <strong>{shortAddress(msg.from)}</strong>
            {msg.from?.name.trim() && <span className="muted"> &lt;{msg.from.address}&gt;</span>}
          </span>
          <span className="muted mail-from__date">{formatDateTime(msg.date)}</span>
        </div>
        {/* Rundmails haben oft Dutzende Empfänger: eingeklappt nur eine Zeile, die volle Liste auf Tipp. */}
        <button type="button" className="mail-to" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          <span className="muted">An:</span> <span className="mail-to__text">{recipientSummary(msg.to, msg.cc) || '–'}</span>
          <ChevronDown size={16} className="mail-to__chevron" aria-hidden="true" />
        </button>
        {showAll && (
          <dl className="mail-meta">
            <dt>An</dt>
            <dd>{addressList(msg.to) || '–'}</dd>
            {msg.cc.length > 0 && (
              <>
                <dt>Cc</dt>
                <dd>{addressList(msg.cc)}</dd>
              </>
            )}
          </dl>
        )}
      </header>

      <div className="mail-actions mail-actions--icons" role="toolbar" aria-label="Aktionen">
        <button type="button" className="icon-btn" aria-label="Antworten" title="Antworten" onClick={() => reply(false)}><Reply size={20} /></button>
        {msg.to.length + msg.cc.length > 1 && (
          <button type="button" className="icon-btn" aria-label="Allen antworten" title="Allen antworten" onClick={() => reply(true)}><ReplyAll size={20} /></button>
        )}
        <button type="button" className="icon-btn" aria-label="Weiterleiten" title="Weiterleiten" onClick={forward}><Forward size={20} /></button>
        <button type="button" className="icon-btn" aria-label="Aufgabe aus Mail" title="Aufgabe aus Mail" onClick={() => setPanel({ kind: 'task' })}><ListPlus size={20} /></button>
        <button type="button" className="icon-btn" aria-label="Protokoll aus Mail" title="Ins Protokoll übernehmen" onClick={() => setPanel({ kind: 'protocol' })}><FileText size={20} /></button>
        <span className="mail-actions__spacer" />
        <button
          type="button"
          className="icon-btn"
          aria-label="Als ungelesen markieren"
          title="Als ungelesen markieren"
          disabled={busy}
          onClick={() =>
            void guarded(async () => {
              await mailApi.setSeen(folder, uid, false);
              navigate(back.to);
            })
          }
        >
          <MailOpen size={20} />
        </button>
        <button type="button" className="icon-btn mail-actions__danger" aria-label="Löschen" title="Löschen" disabled={busy} onClick={() => void remove()}><Trash2 size={20} /></button>
      </div>

      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      {notice && <p role="status" className="muted">{notice}</p>}

      {msg.attachments.length > 0 && (
        <section className="mail-attachments" aria-label="Anhänge">
          {msg.attachments.map((a) => (
            <div key={a.index} className="mail-att">
              <Paperclip size={16} className="muted" aria-hidden="true" />
              <span className="mail-att__name">{a.filename}</span>
              <span className="muted mail-att__size">{formatBytes(a.size)}</span>
              <button type="button" className="icon-btn" disabled={busy} aria-label={`${a.filename} speichern`} title="Speichern" onClick={() => void guarded(() => saveAttachment(folder, uid, a))}>
                <Download size={18} />
              </button>
              <button type="button" className="icon-btn" disabled={busy} aria-label={`${a.filename} ins Protokoll`} title="Ins Protokoll" onClick={() => setPanel({ kind: 'pick', attachments: [a] })}>
                <FileText size={18} />
              </button>
            </div>
          ))}
        </section>
      )}

      {msg.fromHtml && <p className="muted">Diese Mail ist eine HTML-Mail und wird als Text angezeigt (Bilder und Formatierung fehlen).</p>}
      <div className="mail-body" lang="de">{msg.text || <span className="muted">(kein Text)</span>}</div>

      {panel?.kind === 'task' && <TaskSheet msg={msg} onClose={() => setPanel(null)} onDone={() => { setPanel(null); setNotice('Aufgabe angelegt.'); }} />}

      {panel?.kind === 'protocol' && (
        <Sheet title="Ins Protokoll übernehmen" onClose={() => setPanel(null)}>
          <div className="stack">
            <p className="muted">Der Text der Mail wird zum Inhalt, die Anhänge kommen darunter. Das neue Protokoll kannst du danach bearbeiten.</p>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void guarded(async () => {
                  const { placed, skipped } = await placeAttachments(folder, uid, msg.attachments);
                  const id = await createProtocolFromMail(msg, placed);
                  if (skipped.length) await alertDialog(`Nicht übernommen:\n${skipped.join('\n')}`, 'Anhänge');
                  setPanel(null);
                  navigate(`/protokolle/${id}`);
                })
              }
            >
              {busy ? 'Wird angelegt …' : `Neues Protokoll anlegen${msg.attachments.length ? ` (mit ${msg.attachments.length === 1 ? '1 Anhang' : `${msg.attachments.length} Anhängen`})` : ''}`}
            </Button>
            {msg.attachments.length > 0 && <Button disabled={busy} onClick={() => setPanel({ kind: 'pick', attachments: msg.attachments })}>Nur die Anhänge an ein vorhandenes Protokoll hängen</Button>}
          </div>
        </Sheet>
      )}

      {panel?.kind === 'pick' && <ProtocolPicker title="An welches Protokoll anhängen?" onClose={() => setPanel(null)} onPick={(id) => void toProtocols(panel.attachments, { id })} />}
    </div>
  );
}

function TaskSheet({ msg, onClose, onDone }: { msg: MailMessage; onClose: () => void; onDone: () => void }) {
  const base = taskFromMail(msg, null);
  const [title, setTitle] = useState(base.title);
  const [due, setDue] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function save() {
    try {
      await taskRepo.add({ ...base, title, dueDate: due });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  }
  return (
    <Sheet title="Aufgabe aus Mail" onClose={onClose}>
      <label className="field">
        <span>Titel</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <DateField label="Fällig am" clearable value={due} onChange={setDue} />
      <p className="muted">Beschreibung: {base.description.length > 140 ? `${base.description.slice(0, 140)} …` : base.description}</p>
      <p className="muted">Ob die Aufgabe privat oder für alle sichtbar ist, richtet sich nach deiner Einstellung. Im Eintrag lässt es sich ändern.</p>
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      <Button variant="primary" disabled={!title.trim()} onClick={() => void save()}>Aufgabe anlegen</Button>
    </Sheet>
  );
}
