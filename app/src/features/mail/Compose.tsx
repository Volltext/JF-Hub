import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, FileText, Paperclip, Send, X } from 'lucide-react';
import { db } from '@/core/db/db';
import { Button } from '@/core/ui/components';
import { MAX_FILE_BYTES, formatBytes } from '@/features/attachments/limits';
import { pickFiles } from '@/features/attachments/pick';
import { settleProtocol } from '@/features/protokolle/repo';
import { mailApi, type MailAccount, type MailAttachment, type SendRequest } from './api';
import { base64ToBytes, fileToBase64 } from './actions';
import { buildProtocolMail, looksLikeEmail, type Draft } from './compose';
import { ProtocolPicker } from './ProtocolPicker';

interface LocationState {
  draft?: Draft;
  /** Beim Weiterleiten: die Mail, deren Anhänge auf Wunsch mitgehen. */
  forwardOf?: { folder: string; uid: number; attachments: MailAttachment[] };
}

interface Picked {
  name: string;
  mime: string;
  data: string;
  size: number;
}

const MAX_TOTAL = 20 * 1024 * 1024;

/** Schreiben, Antworten, Weiterleiten – auch mit Anhängen und Protokollen als PDF. */
export function Compose({ account }: { account: MailAccount }) {
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as LocationState;
  const [params] = useSearchParams();
  const startProtocol = params.get('protokoll');

  const [to, setTo] = useState(state.draft?.to ?? '');
  const [cc, setCc] = useState(state.draft?.cc ?? '');
  const [showCc, setShowCc] = useState(!!state.draft?.cc);
  const [subject, setSubject] = useState(state.draft?.subject ?? '');
  const [text, setText] = useState(state.draft?.text ?? '');
  const [files, setFiles] = useState<Picked[]>([]);
  const [protocolIds, setProtocolIds] = useState<string[]>(startProtocol ? [startProtocol] : []);
  const [withForwarded, setWithForwarded] = useState(true);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const body = useRef<HTMLTextAreaElement>(null);

  const protocols = useLiveQuery(() => db.protokolle.bulkGet(protocolIds), [protocolIds.join(',')]);

  // Mit einem Protokoll im Anhang gestartet („Per Mail senden“): Betreff und Text vorbereiten.
  useEffect(() => {
    if (!startProtocol || state.draft) return;
    void db.protokolle.get(startProtocol).then((p) => {
      if (!p) return;
      const d = buildProtocolMail(p.title, p.datum);
      setSubject(d.subject);
      setText(d.text);
    });
  }, [startProtocol, state.draft]);

  // Bei Antworten steht der Cursor oben, vor dem Zitat.
  useEffect(() => {
    if (state.draft?.text) body.current?.setSelectionRange(0, 0);
    body.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forwardedSize = state.forwardOf && withForwarded ? state.forwardOf.attachments.reduce((n, a) => n + a.size, 0) : 0;
  const total = files.reduce((n, f) => n + f.size, 0) + forwardedSize;
  const ready = to.split(/[,;]/).some((a) => looksLikeEmail(a.replace(/^.*</, '').replace(/>.*$/, ''))) && !busy;

  async function addFiles() {
    const picked = await pickFiles({ accept: '*/*', multiple: true });
    const skipped: string[] = [];
    const next: Picked[] = [];
    for (const f of picked) {
      if (f.size === 0) skipped.push(`${f.name}: leer`);
      else if (f.size > MAX_FILE_BYTES) skipped.push(`${f.name}: größer als ${formatBytes(MAX_FILE_BYTES)}`);
      else next.push({ name: f.name, mime: f.type || 'application/octet-stream', data: await fileToBase64(f), size: f.size });
    }
    setFiles((old) => [...old, ...next]);
    setError(skipped.length ? `Nicht angehängt: ${skipped.join('; ')}` : '');
  }

  async function send() {
    setError('');
    try {
      if (total > MAX_TOTAL) throw new Error('Die Anhänge sind zusammen größer als 20 MB.');
      const attachments: SendRequest['attachments'] = files.map(({ name, mime, data }) => ({ name, mime, data }));
      if (state.forwardOf && withForwarded) {
        setBusy('Anhänge werden geholt …');
        for (const a of state.forwardOf.attachments) {
          const data = await mailApi.attachment(state.forwardOf.folder, state.forwardOf.uid, a.index);
          if (base64ToBytes(data).length > 0) attachments.push({ name: a.filename, mime: a.contentType, data });
        }
      }
      // Protokolle werden auf dem Server zu PDF: Vorher muss er den neuesten Stand haben.
      for (const id of protocolIds) {
        setBusy('Protokoll wird abgeglichen …');
        await settleProtocol(id);
      }
      setBusy('Wird gesendet …');
      await mailApi.send({ to, cc, subject, text, inReplyTo: state.draft?.inReplyTo, references: state.draft?.references, protocolIds, attachments });
      navigate('/mail', { replace: true, state: { sent: true } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
      setBusy('');
    }
  }

  return (
    <div className="page mail-compose">
      <Link to="/mail" className="back-link">
        <ChevronLeft size={18} /> Abbrechen
      </Link>
      <h1 className="page__title">{state.draft?.inReplyTo ? 'Antworten' : 'Neue Mail'}</h1>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void send();
        }}
      >
        <p className="muted">Von: {account.displayName ? `${account.displayName} <${account.email}>` : account.email}</p>
        <label className="field">
          <span>An</span>
          <input type="text" inputMode="email" autoComplete="off" autoCapitalize="none" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.org, weitere durch Komma trennen" />
        </label>
        {showCc ? (
          <label className="field">
            <span>Cc</span>
            <input type="text" inputMode="email" autoComplete="off" autoCapitalize="none" value={cc} onChange={(e) => setCc(e.target.value)} />
          </label>
        ) : (
          <button type="button" className="chip-btn" onClick={() => setShowCc(true)}>
            Cc hinzufügen
          </button>
        )}
        <label className="field">
          <span>Betreff</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="field">
          <span>Nachricht</span>
          <textarea ref={body} className="textarea mail-compose__text" rows={12} value={text} onChange={(e) => setText(e.target.value)} />
        </label>

        {(files.length > 0 || protocolIds.length > 0 || state.forwardOf?.attachments.length) && (
          <div className="list" aria-label="Anhänge">
            {(protocols ?? []).map((p, i) => (
              <div key={protocolIds[i]} className="item mail-att">
                <FileText size={18} />
                <div className="item__main">
                  <div className="item__title mail-att__name">{p?.title || 'Protokoll'}.pdf</div>
                  <div className="item__sub">Protokoll als PDF im Layout deines Vereins</div>
                </div>
                <button type="button" className="icon-btn" aria-label="Protokoll entfernen" onClick={() => setProtocolIds((ids) => ids.filter((x) => x !== protocolIds[i]))}>
                  <X size={18} />
                </button>
              </div>
            ))}
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="item mail-att">
                <Paperclip size={18} />
                <div className="item__main">
                  <div className="item__title mail-att__name">{f.name}</div>
                  <div className="item__sub">{formatBytes(f.size)}</div>
                </div>
                <button type="button" className="icon-btn" aria-label={`${f.name} entfernen`} onClick={() => setFiles((old) => old.filter((_, j) => j !== i))}>
                  <X size={18} />
                </button>
              </div>
            ))}
            {state.forwardOf && state.forwardOf.attachments.length > 0 && (
              <button type="button" className="toggle" aria-pressed={withForwarded} onClick={() => setWithForwarded(!withForwarded)}>
                <span className="toggle__box">{withForwarded && '✓'}</span> Anhänge der Mail mitschicken ({state.forwardOf.attachments.length})
              </button>
            )}
          </div>
        )}
        {total > 0 && <p className="muted">Anhänge: {formatBytes(total)} von höchstens 20 MB (ohne Protokoll-PDFs)</p>}

        <div className="mail-actions">
          <Button type="button" onClick={() => void addFiles()}>
            <Paperclip size={18} /> Datei anhängen
          </Button>
          <Button type="button" onClick={() => setPicker(true)} disabled={protocolIds.length >= 5}>
            <FileText size={18} /> Protokoll als PDF
          </Button>
        </div>

        {error && (
          <p role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className="muted">
            {busy}
          </p>
        )}
        <Button variant="primary" type="submit" disabled={!ready}>
          <Send size={18} /> Senden
        </Button>
      </form>
      {picker && (
        <ProtocolPicker
          title="Welches Protokoll anhängen?"
          exclude={protocolIds}
          onClose={() => setPicker(false)}
          onPick={(id) => {
            setProtocolIds((ids) => [...ids, id]);
            setPicker(false);
          }}
        />
      )}
    </div>
  );
}
