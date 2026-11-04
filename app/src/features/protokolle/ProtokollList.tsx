import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Folder, FolderPlus, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import { db } from '@/core/db/db';
import { formatDate } from '@/core/domain/format';
import { Button, Card, Sheet } from '@/core/ui/components';
import { confirmDialog } from '@/core/ui/dialog';
import { IS_WEB } from '@/core/env';
import { isMine, useAccount, useDirectory, visibilityLabel } from '@/core/account/account';
import { FolderPicker } from './FolderPicker';
import { NameSheet } from './NameSheet';
import { SyncBadge } from './SyncBadge';
import { dismissConflict, useConflicts } from './conflicts';
import { ROOT, childFolders, folderAndDescendants, folderPath, folderPathLabel, folderRepo, liveFolders, shownFolder } from './folders';
import type { Ordner } from './model';
import { protokolleRepo } from './repo';
import { extractText, searchProtocols } from './search';
import { useSyncStatus } from './syncStatus';

const folderUrl = (id: string) => (id ? `/protokolle/o/${id}` : '/protokolle');

type Dialog = { kind: 'new' } | { kind: 'rename'; folder: Ordner } | { kind: 'menu'; folder: Ordner } | { kind: 'move'; folder: Ordner } | null;

export function ProtokollList() {
  const navigate = useNavigate();
  const { folderId = ROOT } = useParams();
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

  if (!rows || !folders) return null;

  const byId = new Map(rows.map((p) => [p.id, p]));
  const here = folders.find((f) => f.id === folderId);
  const inFolder = folderId && !here ? false : true; // Ordner wurde (auf einem anderen Gerät) gelöscht
  const path = folderPath(folders, folderId);
  const subfolders = childFolders(folders, folderId);
  const protocols = rows
    .filter((p) => shownFolder(folders, p.folderId) === folderId)
    .sort((a, b) => (b.datum || '').localeCompare(a.datum || '') || b.updatedAt - a.updatedAt);
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
    <div className="proto">
      <div className="proto-bar">
        <h1 className="page__title">Protokolle</h1>
        <span className="proto-bar__spacer" />
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
        <input type="search" placeholder="Alle Protokolle durchsuchen" aria-label="Volltextsuche in allen Protokollen" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>

      {hits ? (
        <>
          <p className="muted proto-count">{hits.length === 0 ? 'Keine Treffer.' : `${hits.length} Treffer in allen Ordnern`}</p>
          <div className="list">
            {hits.map((h) => {
              const p = byId.get(h.id)!;
              const where = p.folderId ? folderPathLabel(folders, p.folderId) : '';
              return (
                <Link key={h.id} to={`/protokolle/${h.id}`} className="item proto-hit">
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

          {!inFolder && (
            <Card>
              <p className="muted">Dieser Ordner existiert nicht mehr.</p>
              <p style={{ marginTop: 'var(--s-3)' }}>
                <Link to="/protokolle">Zu allen Protokollen</Link>
              </p>
            </Card>
          )}

          {inFolder && subfolders.length === 0 && protocols.length === 0 && (
            <Card>
              <p className="muted">{folderId ? 'Dieser Ordner ist leer.' : 'Noch keine Protokolle.'} Mit „+“ ein neues Protokoll beginnen.</p>
            </Card>
          )}

          <div className="list">
            {subfolders.map((f) => (
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
            {protocols.map((p) => {
              const text = unsentText?.get(p.id); // undefined: nichts offen · '': ungesendet · sonst: vom Server abgelehnt
              const rejected = p.rejected || text || undefined;
              return (
                <Link key={p.id} to={`/protokolle/${p.id}`} className="item" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="item__main">
                    <div className="item__title">{p.title || 'Ohne Titel'}</div>
                    <div className="item__sub">{[p.datum && formatDate(p.datum), p.ort].filter(Boolean).join(' · ')}</div>
                  </div>
                  {(p.shared || !isMine(p, account)) && <span className="chip">{visibilityLabel(p, account, users)}</span>}
                  {rejected ? (
                    <span className="chip chip--warn" title={rejected}>
                      abgelehnt
                    </span>
                  ) : (
                    (p.dirty === 1 || text !== undefined) && <span className="chip chip--warn">nicht gesendet</span>
                  )}
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
