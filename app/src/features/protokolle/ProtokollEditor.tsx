import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { ChevronDown, ChevronLeft, FileDown, Folder, Lock, Trash2, Users } from 'lucide-react';
import { db } from '@/core/db/db';
import { formatDate } from '@/core/domain/format';
import { confirmDialog } from '@/core/ui/dialog';
import { Button, Sheet } from '@/core/ui/components';
import { isMine, useAccount, useDirectory } from '@/core/account/account';
import { DateField, TimeField } from '@/core/ui/pickers';
import { InkNode } from '@/features/ink/InkNode';
import { FileNode, PhotoNode } from '@/features/attachments/AttachmentNodes';
import { EditorToolbar } from './EditorToolbar';
import { FolderPicker } from './FolderPicker';
import { folderPathLabel, liveFolders } from './folders';
import { SyncBadge } from './SyncBadge';
import type { Protokoll } from './model';
import { exportPdf, protokolleRepo } from './repo';

type Meta = Pick<Protokoll, 'title' | 'datum' | 'beginn' | 'ende' | 'ort' | 'leitung'>;

const metaOf = (p: Protokoll): Meta => ({ title: p.title, datum: p.datum, beginn: p.beginn, ende: p.ende, ort: p.ort, leitung: p.leitung });

/** Lädt das Protokoll einmal und übergibt es dem Editor (der danach selbst den Zustand hält). */
export function ProtokollEditor() {
  const { id = '' } = useParams();
  const [doc, setDoc] = useState<Protokoll | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void db.protokolle.get(id).then((p) => alive && setDoc(p && p.deleted === 0 ? p : null));
    return () => {
      alive = false;
    };
  }, [id]);

  if (doc === undefined) return null;
  if (doc === null) {
    return (
      <div className="proto">
        <Link to="/protokolle" className="proto-back">
          <ChevronLeft size={20} /> Protokolle
        </Link>
        <p className="muted">Dieses Protokoll gibt es nicht (mehr).</p>
      </div>
    );
  }
  return <EditorInner key={doc.id} initial={doc} />;
}

function EditorInner({ initial }: { initial: Protokoll }) {
  const navigate = useNavigate();
  const [meta, setMeta] = useState<Meta>(() => metaOf(initial));
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const account = useAccount();
  const users = useDirectory();

  // Neue Protokolle und breite Bildschirme zeigen die Kopfdaten offen, sonst eine Zusammenfassung.
  const [headOpen, setHeadOpen] = useState(() => !initial.title || window.innerWidth >= 720);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const summary = [meta.datum && formatDate(meta.datum, true), [meta.beginn, meta.ende].filter(Boolean).join('–'), meta.ort, meta.leitung]
    .filter(Boolean)
    .join(' · ');

  // Titelfeld wächst mit dem Text (kein Abschneiden auf schmalen Bildschirmen).
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [meta.title]);

  const metaRef = useRef(meta);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastWritten = useRef(initial.updatedAt);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const queue = useCallback(() => {
    setSaved(false);
    clearTimeout(pending.current);
    pending.current = setTimeout(() => void flushRef.current(), 500);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      InkNode,
      PhotoNode,
      FileNode,
      Placeholder.configure({ placeholder: 'Protokoll schreiben …' }),
    ],
    content: initial.content,
    editorProps: { attributes: { class: 'ed-content', 'aria-label': 'Protokolltext', lang: 'de', spellcheck: 'true' } },
    onUpdate: () => queue(),
    onFocus: () => document.body.classList.add('editing'),
    onBlur: () => document.body.classList.remove('editing'),
  });

  flushRef.current = async () => {
    if (!editor) return;
    clearTimeout(pending.current);
    pending.current = undefined;
    lastWritten.current = await protokolleRepo.save(initial.id, { ...metaRef.current, content: editor.getJSON() });
    setSaved(true);
  };

  // Ungespeichertes beim Verlassen/Wechseln der App sichern.
  useEffect(() => {
    const flushIfPending = () => {
      if (pending.current) void flushRef.current();
    };
    const onHide = () => document.visibilityState === 'hidden' && flushIfPending();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushIfPending);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushIfPending);
      document.body.classList.remove('editing');
      flushIfPending();
    };
  }, []);

  // Änderung von einem anderen Gerät (per Abgleich eingegangen) übernehmen, solange hier nichts offen ist.
  const live = useLiveQuery(() => db.protokolle.get(initial.id), [initial.id]);
  useEffect(() => {
    if (!live || !editor || pending.current || live.updatedAt === lastWritten.current || live.deleted) return;
    lastWritten.current = live.updatedAt;
    editor.commands.setContent(live.content, { emitUpdate: false });
    const m = metaOf(live);
    metaRef.current = m;
    setMeta(m);
  }, [live, editor]);

  const folders = useLiveQuery(liveFolders, []);
  const folderId = live?.folderId ?? initial.folderId ?? '';
  const current = live ?? initial;
  const shared = current.shared === true;
  const mine = isMine(current, account);
  const ownerName = users.find((u) => u.id === current.ownerId)?.name ?? 'einem anderen Betreuer';
  const canDelete = mine || account?.role === 'admin';

  function patchMeta(p: Partial<Meta>) {
    const next = { ...metaRef.current, ...p };
    metaRef.current = next;
    setMeta(next);
    queue();
  }

  async function pdf() {
    setBusy(true);
    setError('');
    try {
      await flushRef.current();
      await exportPdf(initial.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF konnte nicht erstellt werden.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirmDialog('Dieses Protokoll löschen?', { title: meta.title || 'Ohne Titel', confirmLabel: 'Löschen', danger: true }))) return;
    clearTimeout(pending.current);
    pending.current = undefined;
    await protokolleRepo.remove(initial.id);
    navigate(folderId ? `/protokolle/o/${folderId}` : '/protokolle', { replace: true });
  }

  return (
    <div className="proto">
      <div className="proto-bar">
        <Link to={folderId ? `/protokolle/o/${folderId}` : '/protokolle'} className="proto-back" onClick={() => void flushRef.current()}>
          <ChevronLeft size={20} /> Protokolle
        </Link>
        <span className="proto-bar__spacer" />
        <span className="muted proto-saved" aria-live="polite">
          {saved ? 'Gespeichert' : 'Speichert …'}
        </span>
        <SyncBadge compact />
        <button type="button" className="icon-btn" onClick={pdf} disabled={busy} aria-label="Als PDF exportieren" title="Als PDF exportieren">
          <FileDown size={20} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setSharing(true)}
          aria-label={shared ? 'Sichtbarkeit: für alle Betreuer' : 'Sichtbarkeit: privat'}
          title={shared ? 'Für alle Betreuer sichtbar' : 'Nur für dich sichtbar'}
        >
          {shared ? <Users size={20} /> : <Lock size={20} />}
        </button>
        {canDelete && (
          <button type="button" className="icon-btn" onClick={remove} aria-label="Protokoll löschen" title="Löschen">
            <Trash2 size={20} />
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="proto-error">
          {error}
        </p>
      )}

      <section className="proto-sheet">
        <textarea
          ref={titleRef}
          className="proto-title"
          rows={1}
          placeholder="Titel des Protokolls"
          aria-label="Titel"
          value={meta.title}
          maxLength={200}
          onChange={(e) => patchMeta({ title: e.target.value.replace(/\n/g, ' ') })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              editor?.commands.focus('start');
            }
          }}
        />
        <button type="button" className="proto-folder-btn" onClick={() => setPicking(true)} title="In Ordner verschieben">
          <Folder size={16} />
          <span>{folderId ? folderPathLabel(folders ?? [], folderId) || 'Ordner' : 'Alle Protokolle (kein Ordner)'}</span>
        </button>
        <button type="button" className="proto-meta-toggle" aria-expanded={headOpen} onClick={() => setHeadOpen((o) => !o)}>
          <span className="proto-meta-toggle__text">{summary || 'Datum, Zeit und Ort'}</span>
          <ChevronDown size={18} className={headOpen ? 'flip' : undefined} />
        </button>
        {headOpen && (
          <div className="proto-meta">
            <DateField label="Datum" value={meta.datum || null} onChange={(v) => patchMeta({ datum: v ?? '' })} />
            <TimeField label="Beginn" value={meta.beginn} onChange={(v) => patchMeta({ beginn: v })} />
            <TimeField label="Ende" value={meta.ende} onChange={(v) => patchMeta({ ende: v })} />
            <label className="field">
              <span>Ort</span>
              <input value={meta.ort} maxLength={200} onChange={(e) => patchMeta({ ort: e.target.value })} />
            </label>
            <label className="field proto-meta__wide">
              <span>Protokollführung</span>
              <input value={meta.leitung} maxLength={200} onChange={(e) => patchMeta({ leitung: e.target.value })} />
            </label>
          </div>
        )}
      </section>

      {sharing && (
        <Sheet title="Wer sieht dieses Protokoll?" onClose={() => setSharing(false)}>
          <div className="stack">
            <p>
              {shared
                ? mine
                  ? 'Veröffentlicht: Alle Betreuer sehen dieses Protokoll und können es bearbeiten.'
                  : `Veröffentlicht von ${ownerName}: Du kannst es bearbeiten. Zurücknehmen und löschen kann nur ${ownerName}${account?.role === 'admin' ? ' (und du als Admin)' : ''}.`
                : 'Privat: Nur du siehst dieses Protokoll, zum Beispiel als Entwurf.'}
            </p>
            {mine && (
              <Button
                variant={shared ? undefined : 'primary'}
                onClick={async () => {
                  setSharing(false);
                  await flushRef.current();
                  lastWritten.current = await protokolleRepo.save(initial.id, { shared: !shared });
                }}
              >
                {shared ? 'Wieder privat machen' : 'Für alle Betreuer veröffentlichen'}
              </Button>
            )}
            {mine && shared && <p className="muted">Beim Zurücknehmen verschwindet das Protokoll bei den anderen Betreuern.</p>}
          </div>
        </Sheet>
      )}

      {picking && (
        <FolderPicker
          title="Verschieben nach"
          current={folderId}
          onClose={() => setPicking(false)}
          onPick={async (target) => {
            setPicking(false);
            await flushRef.current();
            lastWritten.current = await protokolleRepo.save(initial.id, { folderId: target });
          }}
        />
      )}

      {editor && <EditorToolbar editor={editor} />}

      <div className="proto-sheet proto-sheet--body" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus('end')}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
