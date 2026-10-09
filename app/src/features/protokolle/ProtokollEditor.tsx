import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import Placeholder from '@tiptap/extension-placeholder';
import { ChevronDown, ChevronLeft, FileDown, Folder, Lock, Trash2, Users } from 'lucide-react';
import { db } from '@/core/db/db';
import { formatDate } from '@/core/domain/format';
import { confirmDialog } from '@/core/ui/dialog';
import { Button, Sheet } from '@/core/ui/components';
import { isMine, useAccount, useDirectory } from '@/core/account/account';
import { DateField, TimeField } from '@/core/ui/pickers';
import { createAutosave } from './autosave';
import { dismissConflict, useConflicts } from './conflicts';
import { EXTENSIONS, schemaAccepts } from './editorSchema';
import { EditorToolbar } from './EditorToolbar';
import { FolderPicker } from './FolderPicker';
import { folderPathLabel, liveFolders, shownFolder } from './folders';
import { SyncBadge } from './SyncBadge';
import type { Protokoll } from './model';
import { exportPdf, protokolleRepo } from './repo';
import { UnreadableProtokoll } from './UnreadableProtokoll';

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
  // Enthält das Protokoll Elemente, die diese App-Version nicht kennt, wird es nur gelesen: Ein Editor würde sie verwerfen, und der
  // nächste Autosave überschriebe sie auf dem Server.
  const [blocked, setBlocked] = useState(() => !schemaAccepts(initial.content));
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
  const lastWritten = useRef(initial.updatedAt);
  const editorRef = useRef<Editor | null>(null);
  // Schreibt erst nach einer Ruhepause und nur, wenn es etwas zu schreiben gibt: Öffnen und Zurück ändert ein Protokoll nicht.
  const autosave = useMemo(
    () =>
      createAutosave(
        async () => {
          const ed = editorRef.current;
          if (ed) lastWritten.current = await protokolleRepo.save(initial.id, { ...metaRef.current, content: ed.getJSON() });
        },
        { onDirty: () => setSaved(false), onSaved: () => setSaved(true) },
      ),
    [initial.id],
  );

  const editor = useEditor({
    extensions: [...EXTENSIONS, Placeholder.configure({ placeholder: 'Protokoll schreiben …' })],
    content: initial.content,
    editorProps: { attributes: { class: 'ed-content', 'aria-label': 'Protokolltext', lang: 'de', spellcheck: 'true' } },
    onUpdate: () => autosave.markDirty(),
    onFocus: () => document.body.classList.add('editing'),
    onBlur: () => document.body.classList.remove('editing'),
  });
  editorRef.current = editor;

  // Ungespeichertes beim Verlassen/Wechseln der App sichern.
  useEffect(() => {
    const flush = () => void autosave.flushIfDirty();
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      document.body.classList.remove('editing');
      flush();
    };
  }, [autosave]);

  // Änderung von einem anderen Gerät (per Abgleich eingegangen) übernehmen, solange hier nichts offen ist.
  const live = useLiveQuery(() => db.protokolle.get(initial.id), [initial.id]);
  // Ist das Protokoll inzwischen weg (jemand hat es zurückgezogen oder gelöscht), ginge Tippen ins Leere: nichts würde gespeichert.
  const seenLive = useRef(false);
  if (live) seenLive.current = true;
  const gone = seenLive.current && (live === undefined || live.deleted === 1);
  useEffect(() => {
    if (!live || !editor || autosave.dirty || live.updatedAt === lastWritten.current || live.deleted) return;
    if (!schemaAccepts(live.content)) {
      // Eine neuere App-Version hat Elemente eingefügt, die diese nicht kennt: nicht übernehmen und nichts mehr schreiben.
      setBlocked(true);
      return;
    }
    lastWritten.current = live.updatedAt;
    editor.commands.setContent(live.content, { emitUpdate: false });
    const m = metaOf(live);
    metaRef.current = m;
    setMeta(m);
  }, [live, editor, autosave]);

  useEffect(() => {
    editor?.setEditable(!blocked && !gone);
    if (blocked || gone) autosave.cancel();
  }, [editor, blocked, gone, autosave]);

  const folders = useLiveQuery(liveFolders, []);
  // Ein dem Gerät unbekannter Ordner (von jemand anderem gelöscht) zählt als oberste Ebene, wie in der Liste.
  const rawFolderId = live?.folderId ?? initial.folderId ?? '';
  const folderId = folders ? shownFolder(folders, rawFolderId) : rawFolderId;
  const conflicts = useConflicts();
  const conflict = conflicts?.find((n) => n.id === initial.id || n.copyId === initial.id);
  const current = live ?? initial;
  const shared = current.shared === true;
  const mine = isMine(current, account);
  const ownerName = users.find((u) => u.id === current.ownerId)?.name ?? 'einem anderen Betreuer';
  const canDelete = mine || account?.role === 'admin';

  function patchMeta(p: Partial<Meta>) {
    const next = { ...metaRef.current, ...p };
    metaRef.current = next;
    setMeta(next);
    autosave.markDirty();
  }

  async function pdf() {
    setBusy(true);
    setError('');
    try {
      await autosave.flushIfDirty();
      await exportPdf(initial.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF konnte nicht erstellt werden.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirmDialog('Dieses Protokoll löschen?', { title: meta.title || 'Ohne Titel', confirmLabel: 'Löschen', danger: true }))) return;
    autosave.cancel();
    await protokolleRepo.remove(initial.id);
    navigate(folderId ? `/protokolle/o/${folderId}` : '/protokolle', { replace: true });
  }

  if (blocked) return <UnreadableProtokoll doc={current} backTo={folderId ? `/protokolle/o/${folderId}` : '/protokolle'} />;

  return (
    <div className="proto">
      <div className="proto-bar">
        <Link to={folderId ? `/protokolle/o/${folderId}` : '/protokolle'} className="proto-back" onClick={() => void autosave.flushIfDirty()}>
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
      {gone && (
        <p role="alert" className="proto-error">
          Dieses Protokoll wurde gelöscht oder von jemand anderem zurückgezogen. Änderungen werden nicht mehr gespeichert.
        </p>
      )}
      {conflict && (
        <p role="status" className="proto-notice">
          <span>
            {conflict.id === initial.id
              ? 'Dieses Protokoll wurde zur selben Zeit von jemand anderem geändert. Deine Fassung liegt als Kopie vor.'
              : 'Das ist deine Fassung aus einem gleichzeitigen Bearbeiten. Übernimm, was du brauchst.'}
          </span>
          <Link to={`/protokolle/${conflict.id === initial.id ? conflict.copyId : conflict.id}`}>
            {conflict.id === initial.id ? 'Kopie öffnen' : 'Zum Original'}
          </Link>
          <button type="button" className="btn" onClick={() => void dismissConflict(conflict.copyId)}>
            Verstanden
          </button>
        </p>
      )}
      {current.rejected && (
        <p role="alert" className="proto-error">
          Der Server hat dieses Protokoll abgelehnt ({current.rejected}). Es bleibt auf diesem Gerät, bis du es änderst.
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
                  await autosave.flushIfDirty();
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
            await autosave.flushIfDirty();
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
