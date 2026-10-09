import { useMemo } from 'react';
import { Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Pencil } from 'lucide-react';
import { editInk, type InkEditOutcome } from './editInk';
import { isInkEmpty, normalizeInk, type InkDoc, type InkVariant } from './inkModel';
import { inkSvg } from './inkSvg';
import './ink.css';
import { insertBlocks } from '@/features/protokolle/insertBlocks';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ink: {
      /** Öffnet den Handschrift-Editor; nach „Fertig“ wird die Zeichenfläche an der Cursorposition eingefügt. */
      insertInk: (variant: InkVariant) => ReturnType;
    };
  }
}

const textBlocks = (text: string) =>
  text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }));

function InkView({ node, editor, getPos, updateAttributes, selected }: NodeViewProps) {
  const doc = useMemo(() => normalizeInk(node.attrs.ink), [node.attrs.ink]);
  const variant: InkVariant = node.attrs.variant === 'page' ? 'page' : 'block';
  const svg = useMemo(() => (doc ? inkSvg(doc, { paper: '#ffffff' }) : ''), [doc]);

  async function open() {
    if (!editor.isEditable) return;
    const result = await editInk(doc, variant);
    if (!result) return;
    const pos = getPos();
    if (typeof pos !== 'number') return;
    applyResult(result, pos);
  }

  function applyResult(result: InkEditOutcome, pos: number) {
    const paras = result.text ? textBlocks(result.text) : [];
    const end = pos + node.nodeSize;
    const empty = isInkEmpty(result.doc);
    if (result.textMode === 'replace' || empty) {
      editor.chain().focus().insertContentAt({ from: pos, to: end }, paras).run();
      return;
    }
    updateAttributes({ ink: result.doc });
    if (paras.length) editor.chain().insertContentAt(end, paras).run();
  }

  return (
    <NodeViewWrapper className={`ink-node ink-node--${variant}${selected ? ' is-selected' : ''}`} contentEditable={false} data-drag-handle>
      <button type="button" className="ink-node__sheet" onClick={() => void open()} aria-label="Handschrift bearbeiten">
        {svg ? <span className="ink-node__svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="muted">Leere Zeichenfläche</span>}
        <span className="ink-node__edit">
          <Pencil size={16} /> Bearbeiten
        </span>
      </button>
    </NodeViewWrapper>
  );
}

/** Handschrift im Protokolltext: `block` = Zeichenfläche zwischen Textabsätzen, `page` = ganze Seite. */
export const InkNode = Node.create({
  name: 'ink',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      ink: {
        default: null as InkDoc | null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
      variant: {
        default: 'block',
        parseHTML: (el: HTMLElement) => (el.getAttribute('data-variant') === 'page' ? 'page' : 'block'),
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-variant': attrs.variant === 'page' ? 'page' : 'block' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-ink]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-ink': '', ...HTMLAttributes }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InkView);
  },

  addCommands() {
    return {
      insertInk:
        (variant) =>
        ({ editor }) => {
          void editInk(null, variant).then((result) => {
            if (!result) return;
            const paras = result.text ? textBlocks(result.text) : [];
            const keepInk = !isInkEmpty(result.doc) && !(result.textMode === 'replace' && paras.length);
            if (!keepInk && !paras.length) return;
            const content: unknown[] = keepInk ? [{ type: 'ink', attrs: { ink: result.doc, variant } }, ...paras] : paras;
            content.push({ type: 'paragraph' });
            insertBlocks(editor, content as never); // in einer Tabelle: dahinter, Zellen nehmen keine Zeichnungen auf
          });
          return true;
        },
    };
  },
});
