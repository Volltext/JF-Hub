import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { FileText, Trash2, X } from 'lucide-react';
import { shareBinaryFile } from '@/core/native/files';
import { useOverlayClose } from '@/core/ui/overlay';
import { alertDialog } from '@/core/ui/dialog';
import { formatBytes } from './limits';
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

function PhotoView({ node, editor, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const [open, setOpen] = useState(false);
  const src = String(node.attrs.src ?? '');
  const caption = String(node.attrs.caption ?? '');
  return (
    <NodeViewWrapper className={`photo-node${selected ? ' is-selected' : ''}`} contentEditable={false} data-drag-handle>
      <button type="button" className="photo-node__img" onClick={() => setOpen(true)} aria-label="Foto vergrößern">
        <img src={src} alt={caption || 'Foto'} width={Number(node.attrs.w) || undefined} height={Number(node.attrs.h) || undefined} />
      </button>
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
      {open && <Lightbox src={src} caption={caption} onClose={() => setOpen(false)} />}
    </NodeViewWrapper>
  );
}

function FileView({ node, editor, deleteNode, selected }: NodeViewProps) {
  const name = String(node.attrs.name ?? 'Datei');
  const mime = String(node.attrs.mime ?? 'application/octet-stream');
  return (
    <NodeViewWrapper className={`file-node${selected ? ' is-selected' : ''}`} contentEditable={false} data-drag-handle>
      <button
        type="button"
        className="file-node__main"
        onClick={() =>
          void shareBinaryFile(name, String(node.attrs.data ?? ''), mime).catch(() => alertDialog('Die Datei konnte nicht geöffnet werden.'))
        }
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

/** Foto im Protokolltext (JPEG als Data-URL, vor dem Einfügen verkleinert). */
export const PhotoNode = Node.create({
  name: 'photo',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { src: { default: '', ...noHtml }, w: { default: 0, ...noHtml }, h: { default: 0, ...noHtml }, caption: { default: '', ...noHtml } };
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

/** Dateianhang im Protokolltext (Base64); im PDF nur aufgeführt. */
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
