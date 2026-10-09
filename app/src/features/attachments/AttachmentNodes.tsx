import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { FileText, Trash2, X } from 'lucide-react';
import { bytesToBase64 } from '@/core/domain/base64';
import { shareBinaryFile } from '@/core/native/files';
import { useOverlayClose } from '@/core/ui/overlay';
import { alertDialog } from '@/core/ui/dialog';
import { ensureBlob } from '@/features/protokolle/blobSync';
import { formatBytes } from './limits';
import { usePhoto } from './usePhoto';
import './attachments.css';

function Lightbox({ src, caption, onClose }: { src: string; caption: string; onClose: () => void }) {
  useOverlayClose(onClose);
  return createPortal(
    <div className="photo-lightbox" onClick={onClose}>
      <button type="button" className="btn photo-lightbox__close" aria-label="Schließen" onClick={onClose}>
        <X size={20} />
      </button>
      <img src={src} alt={caption || 'Foto'} />
      {caption && <p>{caption}</p>}
    </div>,
    document.body,
  );
}

/** Was bei einem Foto zu sehen ist, wenn es (noch) kein Bild gibt. */
function PhotoGap({ children, onRetry }: { children: string; onRetry?: () => void }) {
  return (
    <p className="photo-node__missing muted">
      {children}
      {onRetry && (
        <>
          {' '}
          <button type="button" className="link-btn" onClick={onRetry}>
            Erneut versuchen
          </button>
        </>
      )}
    </p>
  );
}

const WHY: Record<string, string> = {
  offline: 'Dieses Foto liegt auf dem Server. Es erscheint, sobald du wieder verbunden bist.',
  'no-server': 'Dieses Foto liegt auf dem Server. Richte die Verbindung zum Server ein, um es zu laden.',
  missing: 'Dieses Foto ist auf dem Server (noch) nicht vorhanden. Vielleicht lädt das Gerät, das es eingefügt hat, es gerade erst hoch.',
};

/** Foto, das auf einen Anhang verweist: aus dem Gerätespeicher, sonst vom Server nachgeladen. */
function StoredPhoto({ blobId, caption, w, h, onOpen }: { blobId: string; caption: string; w: number; h: number; onOpen: (url: string) => void }) {
  const { state, retry } = usePhoto(blobId);
  if (state.status === 'loading') return <PhotoGap>Foto wird geladen …</PhotoGap>;
  if (state.status === 'unavailable') return <PhotoGap onRetry={retry}>{WHY[state.reason] ?? `Das Foto konnte nicht geladen werden (${state.message}).`}</PhotoGap>;
  return (
    <button type="button" className="photo-node__img" onClick={() => onOpen(state.url)} aria-label="Foto vergrößern">
      <img src={state.url} alt={caption || 'Foto'} width={w || undefined} height={h || undefined} />
    </button>
  );
}

function PhotoView({ node, editor, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const [open, setOpen] = useState('');
  const blobId = String(node.attrs.blobId ?? '');
  // Fotos aus Protokollen vor 2.2.0 tragen das Bild noch selbst (Data-URL).
  const src = String(node.attrs.src ?? '');
  const caption = String(node.attrs.caption ?? '');
  const w = Number(node.attrs.w) || 0;
  const h = Number(node.attrs.h) || 0;
  return (
    <NodeViewWrapper className={`photo-node${selected ? ' is-selected' : ''}`} contentEditable={false} data-drag-handle>
      {blobId ? (
        <StoredPhoto blobId={blobId} caption={caption} w={w} h={h} onOpen={setOpen} />
      ) : src ? (
        <button type="button" className="photo-node__img" onClick={() => setOpen(src)} aria-label="Foto vergrößern">
          <img src={src} alt={caption || 'Foto'} width={w || undefined} height={h || undefined} />
        </button>
      ) : (
        <PhotoGap>Dieses Foto kann diese App-Version nicht anzeigen. Bitte die App aktualisieren.</PhotoGap>
      )}
      {editor.isEditable ? (
        <div className="photo-node__bar">
          <input
            className="photo-node__caption"
            placeholder="Beschriftung (optional)"
            value={caption}
            maxLength={200}
            onChange={(e) => updateAttributes({ caption: e.target.value })}
          />
          <button type="button" className="btn" aria-label="Foto entfernen" onClick={() => deleteNode()}>
            <Trash2 size={18} />
          </button>
        </div>
      ) : (
        caption && <p className="photo-node__text">{caption}</p>
      )}
      {open && <Lightbox src={open} caption={caption} onClose={() => setOpen('')} />}
    </NodeViewWrapper>
  );
}

/** Öffnet einen Dateianhang (Teilen-Dialog bzw. Download): aus dem Gerätespeicher oder, falls dort nicht, vom Server. */
async function openFile(attrs: Record<string, unknown>, name: string, mime: string): Promise<void> {
  try {
    const blobId = String(attrs.blobId ?? '');
    if (blobId) {
      const { data } = await ensureBlob({ id: blobId, kind: 'file', mime, name });
      await shareBinaryFile(name, bytesToBase64(data), mime);
      return;
    }
    // Dateien aus Protokollen vor 2.2.0 tragen ihre Daten noch selbst (Base64).
    const data = String(attrs.data ?? '');
    if (!data) return void (await alertDialog('Diese Datei kann diese App-Version nicht öffnen. Bitte die App aktualisieren.'));
    await shareBinaryFile(name, data, mime);
  } catch (e) {
    await alertDialog(e instanceof Error && e.message ? `Die Datei konnte nicht geöffnet werden: ${e.message}` : 'Die Datei konnte nicht geöffnet werden.');
  }
}

function FileView({ node, editor, deleteNode, selected }: NodeViewProps) {
  const name = String(node.attrs.name ?? 'Datei');
  const mime = String(node.attrs.mime ?? 'application/octet-stream');
  return (
    <NodeViewWrapper className={`file-node${selected ? ' is-selected' : ''}`} contentEditable={false} data-drag-handle>
      <button
        type="button"
        className="file-node__main"
        onClick={() => void openFile(node.attrs, name, mime)}
      >
        <FileText size={22} />
        <span className="file-node__name">{name}</span>
        <span className="file-node__size muted">{formatBytes(Number(node.attrs.size) || 0)}</span>
      </button>
      {editor.isEditable && (
        <button type="button" className="btn" aria-label="Anhang entfernen" onClick={() => deleteNode()}>
          <Trash2 size={18} />
        </button>
      )}
    </NodeViewWrapper>
  );
}

/** Die großen Daten stehen nur im JSON des Protokolls, nie im HTML (kein Base64 in der Zwischenablage). */
const noHtml = { parseHTML: () => null, renderHTML: () => ({}) };

/** Foto im Protokolltext: verweist auf einen Anhang (`blobId`); ältere Protokolle tragen das JPEG noch als Data-URL in `src`. */
export const PhotoNode = Node.create({
  name: 'photo',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: '', ...noHtml },
      w: { default: 0, ...noHtml },
      h: { default: 0, ...noHtml },
      caption: { default: '', ...noHtml },
      // Verweis auf den Anhang (Server und Gerätespeicher), in dem das Foto liegt.
      blobId: { default: null, ...noHtml },
      mime: { default: null, ...noHtml },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-photo]' }];
  },
  renderHTML() {
    return ['div', { 'data-photo': '' }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PhotoView);
  },
});

/** Dateianhang im Protokolltext: verweist auf einen Anhang (`blobId`); ältere Protokolle tragen die Daten noch als Base64 in `data`. Im PDF nur aufgeführt. */
export const FileNode = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      name: { default: 'Datei', ...noHtml },
      mime: { default: 'application/octet-stream', ...noHtml },
      size: { default: 0, ...noHtml },
      data: { default: '', ...noHtml },
      /** Siehe PhotoNode: Verweis auf den Anhang. */
      blobId: { default: null, ...noHtml },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-attachment]' }];
  },
  renderHTML() {
    return ['div', { 'data-attachment': '' }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FileView);
  },
});
