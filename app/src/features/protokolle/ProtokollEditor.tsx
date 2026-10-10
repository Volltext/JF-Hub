import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import Collaboration from '@tiptap/extension-collaboration';
import Placeholder from '@tiptap/extension-placeholder';
import { ChevronDown, ChevronLeft, FileDown, Folder, Lock, Trash2, Users } from 'lucide-react';
import { db } from '@/core/db/db';
import { requeueBlobs } from '@/core/db/blobs';
import { formatDate } from '@/core/domain/format';
import { confirmDialog } from '@/core/ui/dialog';
import { Button, Sheet } from '@/core/ui/components';
import { isMine, useAccount, useDirectory } from '@/core/account/account';
import { DateField, TimeField } from '@/core/ui/pickers';
import { uploadPendingBlobs } from './blobSync';
import { createAutosave } from './autosave';
import { Presence } from './collab/Presence';
import { LocalTrailingNode } from './collab/localExtensions';
import { openProtocol, type Opened } from './collab/openPlan';
import { isEditable, type CollabSession } from './collab/session';
import { EPOCH_KEY, httpExchange } from './collab/wire';
import { FIELD } from './collab/yJson';
import { dismissConflict, useConflicts } from './conflicts';
import { EXTENSIONS } from './editorSchema';
import { EditorToolbar } from './EditorToolbar';
import { FolderPicker } from './FolderPicker';
import { folderPathLabel, liveFolders, shownFolder } from './folders';
import { loadConn } from './http';
import { openLink } from './openLink';
import { flattenCellContent } from './pasteTables';
import { SyncBadge } from './SyncBadge';
import type { Protokoll } from './model';
import { exportPdf, protokolleRepo } from './repo';
import { scheduleSync } from './sync';
import { UnreadableProtokoll } from './UnreadableProtokoll';

type Meta = Pick<Protokoll, 'title' | 'datum' | 'beginn' | 'ende' | 'ort' | 'leitung'>;
type MetaKey = keyof Meta;
const META_KEYS: MetaKey[] = ['title', 'datum', 'beginn', 'ende', 'ort', 'leitung'];

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
  return <EditorShell key={doc.id} initial={doc} />;
}

/**
 * Bereitet das Bearbeiten vor: Der Editor bindet sich immer an das Yjs-Dokument des Protokolls (`collab/session.ts`). Woher es kommt und
 * ob der Editor es ohne Verlust bauen kann, klärt `openProtocol`; sonst gibt es nur die Nur-lesen-Ansicht mit Erklärung.
 */
function EditorShell({ initial }: { initial: Protokoll }) {
  const [opened, setOpened] = useState<Opened | undefined>();
  const [attempt, setAttempt] = useState(0);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    let cancelled = false;
    let mine: CollabSession | undefined;
    setOpened(undefined);
    void openProtocol(initial.id, {
      transport: httpExchange(async () => (await db.kv.get(EPOCH_KEY))?.value as string | undefined),
      hasServer: async () => {
        const conn = await loadConn();
        return !!conn.url && !!conn.token;
      },
      session: {
        // Während der Tastatur-Eingabe mit Wortvorschlägen (Komposition) ändert sich der Text nicht unter den Fingern.
        busy: () => editorRef.current?.view.composing === true,
        // Ein neues Protokoll, das der Server noch nicht kennt, wartet auf den Abgleich der Kopfdaten.
        requestSync: () => scheduleSync(300),
        beforeSend: async () => void (await uploadPendingBlobs()),
        onMissingBlobs: (ids) => void requeueBlobs(ids),
        onReplaced: () => setAttempt((n) => n + 1),
      },
    }).then((result) => {
      if (cancelled) {
        if (result.kind === 'edit') void result.session.destroy();
        return;
      }
      if (result.kind === 'edit') {
        mine = result.session;
        result.session.start();
      }
      setOpened(result);
    }).catch(() => {
      // `openProtocol` fängt Fehler selbst ab; das hier hält die Seite auch bei einem unerwarteten Fehler nicht leer.
      if (!cancelled) setOpened({ kind: 'readonly', reason: 'failed', message: 'Das Protokoll ließ sich nicht öffnen. Bitte noch einmal versuchen.' });
    });
    return () => {
      cancelled = true;
      void mine?.destroy();
    };
  }, [initial.id, attempt]);

  if (!opened) return null;
  const back = initial.folderId ? `/protokolle/o/${initial.folderId}` : '/protokolle';
  if (opened.kind === 'readonly') {
    if (opened.reason === 'gone') return <UnreadableProtokoll doc={initial} backTo={back} message={opened.message} />;
    return <UnreadableProtokoll doc={initial} backTo={back} message={opened.message} onRetry={opened.reason === 'needs-server' || opened.reason === 'failed' ? () => setAttempt((n) => n + 1) : undefined} />;
  }
  return <EditorInner key={attempt} initial={initial} session={opened.session} editorRef={editorRef} />;
}

function EditorInner({ initial, session, editorRef }: { initial: Protokoll; session: CollabSession; editorRef: MutableRefObject<Editor | null> }) {
  const navigate = useNavigate();
  const [meta, setMeta] = useState<Meta>(() => metaOf(initial));
  const [metaSaved, setMetaSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const info = useSyncExternalStore(session.subscribe, session.getInfo);
  const saved = metaSaved && info.saved;
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
  /** Kopfdaten, die hier getippt, aber noch nicht gespeichert sind. Nur sie werden geschrieben und nur sie werden beim Abgleich nicht überschrieben. */
  const edited = useRef(new Set<MetaKey>());
  // Schreibt erst nach einer Ruhepause und nur, was sich geändert hat: Öffnen und Zurück ändert ein Protokoll nicht. Der Text hat sein eigenes
  // Speichern (die Sitzung); hier geht es nur um Titel, Datum, Zeiten, Ort und Leitung. Jedes Feld zählt für sich, damit die Änderung
  // eines anderen Geräts an einem anderen Feld nicht überschrieben wird.
  const autosave = useMemo(
    () =>
      createAutosave(
        async () => {
          const pending = new Map<MetaKey, string>();
          for (const k of edited.current) pending.set(k, metaRef.current[k]);
          if (pending.size) await protokolleRepo.save(initial.id, Object.fromEntries(pending) as Partial<Meta>);
          // Erst nach dem Speichern freigeben (und nur, was inzwischen nicht weitergetippt wurde): So holt die Anzeige keinen alten Wert zurück.
          for (const [k, v] of pending) if (metaRef.current[k] === v) edited.current.delete(k);
        },
        { onDirty: () => setMetaSaved(false), onSaved: () => setMetaSaved(true) },
      ),
    [initial.id],
  );

  const editor = useEditor({
    // Der Text kommt aus dem geteilten Dokument der Sitzung (Zusammenarbeit); der Editor schreibt hinein und liest daraus.
    extensions: [...EXTENSIONS, LocalTrailingNode, Collaboration.configure({ document: session.doc, field: FIELD }), Placeholder.configure({ placeholder: 'Protokoll schreiben …' })],
    editorProps: {
      attributes: { class: 'ed-content', 'aria-label': 'Protokolltext', lang: 'de', spellcheck: 'true' },
      // Eingefügte Tabellen aus anderen Programmen: Was eine Zelle nicht aufnimmt, wird zu Absätzen (sonst zerreißt die Tabelle).
      transformPastedHTML: flattenCellContent,
      handleDOMEvents: {
        // Strg/Cmd+Klick öffnet einen Link (am Handy dient dazu die Link-Leiste); ein einfacher Klick setzt nur den Cursor.
        click: (_view, event) => {
          if (!(event.ctrlKey || event.metaKey)) return false;
          const href = (event.target as Element | null)?.closest?.('a[href]')?.getAttribute('href');
          if (!href) return false;
          event.preventDefault();
          openLink(href);
          return true;
        },
      },
    },
    onFocus: () => document.body.classList.add('editing'),
    onBlur: () => document.body.classList.remove('editing'),
  });
  editorRef.current = editor;

  // Ungespeichertes beim Verlassen/Wechseln der App sichern.
  useEffect(() => {
    const flush = () => {
      void autosave.flushIfDirty();
      void session.flush().catch(() => undefined);
    };
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      document.body.classList.remove('editing');
      void autosave.flushIfDirty();
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [autosave, session, editor, editorRef]);

  // Änderungen der Kopfdaten von einem anderen Gerät (per Abgleich eingegangen) übernehmen, Feld für Feld und nur, was hier nicht in Arbeit ist.
  const live = useLiveQuery(() => db.protokolle.get(initial.id), [initial.id]);
  // Ist das Protokoll inzwischen weg (jemand hat es zurückgezogen oder gelöscht), ginge Tippen ins Leere: nichts würde gespeichert.
  const seenLive = useRef(false);
  if (live) seenLive.current = true;
  const gone = info.status === 'gone' || (seenLive.current && (live === undefined || live.deleted === 1));
  useEffect(() => {
    if (!live || live.deleted) return;
    const next = { ...metaRef.current };
    let changed = false;
    for (const k of META_KEYS) {
      if (edited.current.has(k) || next[k] === live[k]) continue;
      next[k] = live[k];
      changed = true;
    }
    if (changed) {
      metaRef.current = next;
      setMeta(next);
    }
  }, [live]);

  // Enthält das geteilte Dokument Elemente, die diese App-Version nicht kennt, oder hat der Server den Text nicht umgestellt: nur lesen.
  const readOnlyStatus = info.status === 'blocked' || info.status === 'legacy';
  const editable = isEditable(info.status) && !gone;
  useEffect(() => {
    editor?.setEditable(editable);
    if (!editable) autosave.cancel();
  }, [editor, editable, autosave]);

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
    for (const k of Object.keys(p) as MetaKey[]) edited.current.add(k);
    metaRef.current = next;
    setMeta(next);
    autosave.markDirty();
  }

  async function pdf() {
    setBusy(true);
    setError('');
    try {
      await autosave.flushIfDirty();
      await session.flush();
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

  if (readOnlyStatus) return <UnreadableProtokoll doc={current} backTo={folderId ? `/protokolle/o/${folderId}` : '/protokolle'} message={info.message || undefined} />;

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
          {info.status === 'gone' && ' Was du noch nicht abgeben konntest, liegt als Kopie „(lokale Fassung)“ in deinen Protokollen.'}
        </p>
      )}
      {!gone && info.message && (
        <p role="alert" className="proto-error">
          {info.message}
        </p>
      )}
      {info.offline && (
        <p role="status" className="proto-offline">
          Offline: Deine Änderungen sind auf diesem Gerät gesichert und gehen später zum Server.
        </p>
      )}
      <Presence ids={info.peers} />
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
                  await protokolleRepo.save(initial.id, { shared: !shared });
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
            await protokolleRepo.save(initial.id, { folderId: target });
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
