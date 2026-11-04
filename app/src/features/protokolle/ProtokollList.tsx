import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownUp, ChevronRight, FileText, Folder, FolderPlus, Hash, MoreHorizontal, Plus, Search, Trash2, X } from 'lucide-react';
import { db } from '@/core/db/db';
import { formatDate, formatDateRelative } from '@/core/domain/format';
import { todayIso } from '@/core/domain/id';
import { Button, Card, EmptyState, Sheet } from '@/core/ui/components';
import { confirmDialog } from '@/core/ui/dialog';
import { IS_WEB } from '@/core/env';
import { isMine, useAccount, useDirectory, visibilityLabel } from '@/core/account/account';
import { FolderPicker } from './FolderPicker';
import { NameSheet } from './NameSheet';
import { SyncBadge } from './SyncBadge';
import { dismissConflict, useConflicts } from './conflicts';
import { ROOT, childFolders, folderAndDescendants, folderPath, folderPathLabel, folderRepo, liveFolders, shownFolder } from './folders';
import type { Ordner, Protokoll } from './model';
import { protokolleRepo } from './repo';
import { extractText, searchProtocols } from './search';
import { noteInfo } from './preview';
import { tagMatches } from './tags';
import { useSyncStatus } from './syncStatus';

const folderUrl = (id: string) => (id ? `/protokolle/o/${id}` : '/protokolle');

type Sort = 'datum' | 'bearbeitet';
const SORT_KEY = 'jfhub.proto.sort';
const loadSort = (): Sort => {
  try {
    return localStorage.getItem(SORT_KEY) === 'bearbeitet' ? 'bearbeitet' : 'datum';
  } catch {
    return 'datum';
  }
};

type Dialog = { kind: 'new' } | { kind: 'rename'; folder: Ordner } | { kind: 'menu'; folder: Ordner } | { kind: 'move'; folder: Ordner } | null;

/**
 * Liste der Protokolle. Am Laptop steht sie als Spalte neben dem Editor (`split`): Dann ist `activeId` das geöffnete Protokoll,
 * und der Ordner kommt von außen (`folder`), weil die Spalte außerhalb der Unterrouten liegt.
 */
export function ProtokollList({ split = false, folder, activeId }: { split?: boolean; folder?: string; activeId?: string } = {}) {
  const navigate = useNavigate();
  const params = useParams();
  const folderId = (split ? folder : params.folderId) ?? ROOT;
  const [search, setSearch] = useSearchParams();
  const tag = search.get('tag') ?? '';
  const setTag = (t: string) => setSearch(t ? { tag: t } : {}, { replace: true });
  const [sort, setSortState] = useState<Sort>(loadSort);
  const setSort = (v: Sort) => {
    setSortState(v);
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {
      /* ohne Speicher gilt die Wahl nur für diese Sitzung */
    }
  };
  const rows = useLiveQuery(() => db.protokolle.filter((p) => p.deleted === 0).toArray(), []);
  // Texte, die der Server noch nicht bestätigt hat (der Text hat sein eigenes Merkmal), und der Grund, wenn er einen abgelehnt hat.
  const unsentText = useLiveQuery(async () => new Map((await db.ydocs.where('dirty').equals(1).toArray()).map((r) => [r.id, r.rejected ?? ''] as const)), []);
  const folders = useLiveQuery(liveFolders, []);
  const syncState = useSyncStatus((s) => s.state);
  const syncMessage = useSyncStatus((s) => s.message);
  const conflicts = useConflicts();
  const account = useAccount();
  const users = useDirectory();
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // „/“ springt in die Suche, wenn gerade nirgends getippt wird (wie in vielen Notiz-Apps).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const [dialog, setDialog] = useState<Dialog>(null);

  // Die Suche läuft mit leicht verzögertem Suchwort, damit das Tippen flüssig bleibt (bei vielen Protokollen dauert sie spürbar).
  const query = useDeferredValue(q).trim();
  const searching = query !== '';
  // Volltextindex: Reintext je Protokoll. Er wird nur gebaut, wenn gesucht wird, und nur neu, wenn sich die Daten ändern.
  const index = useMemo(
    () => (searching ? (rows ?? []).map((p) => ({ id: p.id, title: p.title, ort: p.ort, leitung: p.leitung, text: extractText(p.content) })) : []),
    [rows, searching],
  );
  const hits = useMemo(() => (searching ? searchProtocols(index, query) : null), [index, query, searching]);

  // Vorschau und Tags je Protokoll; nur neu, wenn sich die Zeilen ändern.
  const infos = useMemo(() => new Map((rows ?? []).map((p) => [p.id, noteInfo(p.content)] as const)), [rows]);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, { name: string; n: number }>();
    for (const info of infos.values())
      for (const t of info.tags) {
        const k = t.toLowerCase();
        counts.set(k, { name: counts.get(k)?.name ?? t, n: (counts.get(k)?.n ?? 0) + 1 });
      }
    return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'de'));
  }, [infos]);

  if (!rows || !folders) return null;
  const today = todayIso();

  const byId = new Map(rows.map((p) => [p.id, p]));
  const here = folders.find((f) => f.id === folderId);
  const inFolder = folderId && !here ? false : true; // Ordner wurde (auf einem anderen Gerät) gelöscht
  const path = folderPath(folders, folderId);
  const subfolders = childFolders(folders, folderId);
  const byOrder = (a: Protokoll, b: Protokoll) =>
    sort === 'bearbeitet' ? b.updatedAt - a.updatedAt : (b.datum || '').localeCompare(a.datum || '') || b.updatedAt - a.updatedAt;
  // Mit gewähltem Tag zählen alle Ordner, sonst nur der aktuelle.
  const tagged = tag ? rows.filter((p) => infos.get(p.id)?.tags.some((t) => tagMatches(t, tag))).sort(byOrder) : null;
  const protocols = rows.filter((p) => shownFolder(folders, p.folderId) === folderId).sort(byOrder);
  const countIn = (id: string) => rows.filter((p) => shownFolder(folders, p.folderId) === id).length + folders.filter((f) => f.parentId === id).length;

  async function create() {
    const p = await protokolleRepo.create(folderId);
    navigate(`/protokolle/${p.id}`);
  }

  async function removeFolder(f: Ordner) {
    const n = countIn(f.id);
    const msg = n ? `Der Inhalt (${n} Einträge) wird eine Ebene nach oben verschoben, nichts wird gelöscht.` : 'Der leere Ordner wird gelöscht.';
    if (!(await confirmDialog(msg, { title: `Ordner „${f.name}“ löschen?`, confirmLabel: 'Löschen', danger: true }))) return;
    await folderRepo.remove(f.id);
    if (f.id === folderId) navigate(folderUrl(f.parentId), { replace: true });
  }

  return (
    <div className={`proto${split ? ' proto--list' : ''}`}>
      <div className="proto-bar">
        <h1 className="page__title">Protokolle</h1>
        <span className="proto-bar__spacer" />
        <button
          type="button"
          className="icon-btn"
          aria-label={sort === 'datum' ? 'Sortiert nach Datum – nach letzter Änderung sortieren' : 'Sortiert nach letzter Änderung – nach Datum sortieren'}
          title={sort === 'datum' ? 'Sortiert nach Datum' : 'Sortiert nach letzter Änderung'}
          onClick={() => setSort(sort === 'datum' ? 'bearbeitet' : 'datum')}
        >
          <ArrowDownUp size={19} />
        </button>
        {split && (
          <button type="button" className="icon-btn icon-btn--primary" aria-label="Neues Protokoll" title="Neues Protokoll" onClick={() => void create()}>
            <Plus size={20} />
          </button>
        )}
        {syncState !== 'off' && (
          <Link to="/protokolle/papierkorb" className="icon-btn" aria-label="Papierkorb" title="Papierkorb">
            <Trash2 size={20} />
          </Link>
        )}
        <SyncBadge />
      </div>

      {syncState === 'off' && !IS_WEB && (
        <Card title="Server einrichten">
          <p className="muted">Damit Protokolle auf allen Geräten und für alle Betreuer verfügbar sind, meldest du dich an deinem JF-Hub-Server an.</p>
          <p style={{ marginTop: 'var(--s-3)' }}>
            <Link to="/einstellungen/server">Zu den Einstellungen</Link>
          </p>
        </Card>
      )}
      {syncState === 'auth' && (
        <Card title="Neu anmelden">
          <p className="muted">Die Anmeldung am Server ist abgelaufen oder wurde beendet.</p>
          {!IS_WEB && (
            <p style={{ marginTop: 'var(--s-3)' }}>
              <Link to="/einstellungen/server">Zu den Einstellungen</Link>
            </p>
          )}
        </Card>
      )}

      {syncState === 'error' && syncMessage && (
        <Card title="Abgleich fehlgeschlagen">
          <p className="muted">{syncMessage}</p>
        </Card>
      )}
      {(conflicts ?? [])
        .filter((n) => byId.has(n.copyId))
        .map((n) => (
          <Card key={n.copyId} title="Gleichzeitig bearbeitet">
            <p>„{byId.get(n.id)?.title || 'Ohne Titel'}“ wurde zur selben Zeit von jemand anderem geändert. Deine Fassung liegt als Kopie vor – schau nach, ob etwas übernommen werden soll.</p>
            <p className="row" style={{ marginTop: 'var(--s-3)' }}>
              <Link to={`/protokolle/${n.copyId}`} className="btn btn--primary">
                Kopie öffnen
              </Link>
              <Button onClick={() => void dismissConflict(n.copyId)}>Verstanden</Button>
            </p>
          </Card>
        ))}

      <label className="proto-search">
        <Search size={18} />
        <input ref={searchRef} type="search" placeholder="Alle Protokolle durchsuchen   ( / )" aria-label="Volltextsuche in allen Protokollen" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>

      {tagCounts.length > 0 && (
        <div className="tagbar" role="group" aria-label="Nach Tag filtern">
          <button type="button" className="tagchip" aria-pressed={!tag} onClick={() => setTag('')}>
            Alle
          </button>
          {tagCounts.map((t) => (
            <button key={t.name} type="button" className="tagchip" aria-pressed={tag.toLowerCase() === t.name.toLowerCase()} onClick={() => setTag(tag.toLowerCase() === t.name.toLowerCase() ? '' : t.name)}>
              <Hash size={13} />
              {t.name}
              <span className="tagchip__n">{t.n}</span>
            </button>
          ))}
        </div>
      )}

      {hits ? (
        <>
          <p className="muted proto-count">{hits.length === 0 ? 'Keine Treffer.' : `${hits.length} Treffer in allen Ordnern`}</p>
          <div className="list">
            {hits.map((h) => {
              const p = byId.get(h.id)!;
              const where = p.folderId ? folderPathLabel(folders, p.folderId) : '';
              return (
                <Link key={h.id} to={`/protokolle/${h.id}`} className={`item proto-hit${h.id === activeId ? ' is-active' : ''}`}>
                  <div className="item__main">
                    <div className="item__title">{p.title || 'Ohne Titel'}</div>
                    <div className="item__sub">{[p.datum && formatDate(p.datum), where].filter(Boolean).join(' · ')}</div>
                    {h.snippet && (
                      <div className="proto-snippet">
                        {h.snippet.parts.map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {tagged ? (
            <div className="proto-filter">
              <span>
                Tag <strong>#{tag}</strong> · {tagged.length === 1 ? '1 Protokoll' : `${tagged.length} Protokolle`} in allen Ordnern
              </span>
              <button type="button" className="icon-btn proto-crumbs__btn" aria-label="Filter aufheben" onClick={() => setTag('')}>
                <X size={16} />
              </button>
            </div>
          ) : (
          <nav className="proto-crumbs" aria-label="Ordnerpfad">
            <Link to="/protokolle" aria-current={folderId === ROOT ? 'page' : undefined}>
              Alle Protokolle
            </Link>
            {path.map((f) => (
              <span key={f.id} className="proto-crumbs__part">
                <ChevronRight size={14} />
                <Link to={folderUrl(f.id)} aria-current={f.id === folderId ? 'page' : undefined}>
                  {f.name}
                </Link>
              </span>
            ))}
            <span className="proto-bar__spacer" />
            {here && (
              <button type="button" className="icon-btn proto-crumbs__btn" aria-label="Ordner verwalten" onClick={() => setDialog({ kind: 'menu', folder: here })}>
                <MoreHorizontal size={18} />
              </button>
            )}
            <button type="button" className="icon-btn proto-crumbs__btn" aria-label="Neuer Ordner" title="Neuer Ordner" onClick={() => setDialog({ kind: 'new' })}>
              <FolderPlus size={18} />
            </button>
          </nav>
          )}

          {!inFolder && (
            <Card>
              <p className="muted">Dieser Ordner existiert nicht mehr.</p>
              <p style={{ marginTop: 'var(--s-3)' }}>
                <Link to="/protokolle">Zu allen Protokollen</Link>
              </p>
            </Card>
          )}

          {inFolder && !tagged && subfolders.length === 0 && protocols.length === 0 && (
            <EmptyState icon={FileText} title={folderId ? 'Dieser Ordner ist leer' : 'Noch keine Protokolle'} action={<Button variant="primary" onClick={() => void create()}>Protokoll schreiben</Button>}>
              Schreib einfach los. Mit #Tags im Text ordnest du Protokolle, ohne Ordner anzulegen.
            </EmptyState>
          )}
          {tagged && tagged.length === 0 && <p className="muted proto-count">Kein Protokoll mit diesem Tag.</p>}

          <div className="list">
            {!tagged && subfolders.map((f) => (
              <div key={f.id} className="item proto-folder">
                <Link to={folderUrl(f.id)} className="proto-folder__link">
                  <Folder size={22} className="proto-folder__icon" />
                  <div className="item__main">
                    <div className="item__title">{f.name}</div>
                    <div className="item__sub">{countIn(f.id) === 1 ? '1 Eintrag' : `${countIn(f.id)} Einträge`}</div>
                  </div>
                </Link>
                <button type="button" className="icon-btn" aria-label={`Ordner „${f.name}“ verwalten`} onClick={() => setDialog({ kind: 'menu', folder: f })}>
                  <MoreHorizontal size={18} />
                </button>
              </div>
            ))}
            {(tagged ?? protocols).map((p) => {
              const text = unsentText?.get(p.id); // undefined: nichts offen · '': ungesendet · sonst: vom Server abgelehnt
              const rejected = p.rejected || text || undefined;
              const info = infos.get(p.id);
              const when = p.datum ? formatDateRelative(p.datum, today) : '';
              const where = tagged && p.folderId ? folderPathLabel(folders, p.folderId) : '';
              return (
                <Link key={p.id} to={`/protokolle/${p.id}`} className={`item note${p.id === activeId ? ' is-active' : ''}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="item__main">
                    <div className="note__head">
                      <span className="item__title note__title">{p.title || 'Ohne Titel'}</span>
                      {when && <span className="note__date">{when}</span>}
                    </div>
                    {info?.preview && <div className="note__preview">{info.preview}</div>}
                    {(info?.tags.length || p.ort || where || p.shared || !isMine(p, account) || rejected || p.dirty === 1 || text !== undefined) && (
                      <div className="note__meta">
                        {[p.ort, where].filter(Boolean).length > 0 && <span className="note__place">{[p.ort, where].filter(Boolean).join(' · ')}</span>}
                        {info?.tags.slice(0, 4).map((t) => (
                          <span key={t} className="note__tag">
                            #{t}
                          </span>
                        ))}
                        {(p.shared || !isMine(p, account)) && <span className="chip">{visibilityLabel(p, account, users)}</span>}
                        {rejected ? (
                          <span className="chip chip--warn" title={rejected}>
                            abgelehnt
                          </span>
                        ) : (
                          (p.dirty === 1 || text !== undefined) && <span className="chip chip--warn">nicht gesendet</span>
                        )}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <button className="fab proto-fab" aria-label="Neues Protokoll" onClick={() => void create()}>
        <Plus />
      </button>

      {dialog?.kind === 'new' && (
        <NameSheet
          title={here ? `Neuer Ordner in „${here.name}“` : 'Neuer Ordner'}
          confirmLabel="Ordner anlegen"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            setDialog(null);
            const f = await folderRepo.create(name, folderId);
            navigate(folderUrl(f.id));
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <NameSheet
          title="Ordner umbenennen"
          initial={dialog.folder.name}
          confirmLabel="Speichern"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            setDialog(null);
            await folderRepo.rename(dialog.folder.id, name);
          }}
        />
      )}
      {dialog?.kind === 'menu' && (
        <Sheet title={dialog.folder.name} onClose={() => setDialog(null)}>
          <div className="stack">
            <Button onClick={() => setDialog({ kind: 'rename', folder: dialog.folder })}>Umbenennen</Button>
            <Button onClick={() => setDialog({ kind: 'move', folder: dialog.folder })}>In anderen Ordner verschieben</Button>
            <Button
              variant="danger"
              onClick={() => {
                const f = dialog.folder;
                setDialog(null);
                void removeFolder(f);
              }}
            >
              Ordner löschen
            </Button>
          </div>
        </Sheet>
      )}
      {dialog?.kind === 'move' && (
        <FolderPicker
          title={`„${dialog.folder.name}“ verschieben nach`}
          current={dialog.folder.parentId}
          exclude={folderAndDescendants(folders, dialog.folder.id)}
          onClose={() => setDialog(null)}
          onPick={async (target) => {
            setDialog(null);
            await folderRepo.move(dialog.folder.id, target);
          }}
        />
      )}
    </div>
  );
}
