import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eraser, Grid3x3, Hand, Highlighter, PenLine, Redo2, Undo2 } from 'lucide-react';
import { confirmDialog } from '@/core/ui/dialog';
import { useOverlayClose } from '@/core/ui/overlay';
import { finishWebInk, useWebInkRequest } from './editInk';
import {
  INK_BLOCK_MAX_HEIGHT,
  INK_COLORS,
  INK_HIGHLIGHT_COLORS,
  type InkBg,
  type InkDoc,
  type InkStroke,
  type InkVariant,
} from './inkModel';
import { inkSvg } from './inkSvg';
import './ink.css';

type Tool = 'pen' | 'marker' | 'eraser';
type Op = { kind: 'add'; stroke: InkStroke } | { kind: 'remove'; items: { index: number; stroke: InkStroke }[] };

const PEN_SIZES = [1.6, 2.6, 4.4];
const MARKER_SIZES = [16, 24, 34];
const BGS: InkBg[] = ['none', 'lined', 'grid', 'dots'];
const BG_LABEL: Record<InkBg, string> = { none: 'Blanko', lined: 'Liniert', grid: 'Kariert', dots: 'Gepunktet' };
const ERASER_RADIUS = 9;

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function hits(st: InkStroke, x: number, y: number, r: number): boolean {
  const reach = r + st.w / 2;
  const p = st.p;
  if (p.length === 3) return Math.hypot(x - p[0]!, y - p[1]!) <= reach;
  for (let i = 0; i + 5 < p.length; i += 3) {
    if (distToSegment(x, y, p[i]!, p[i + 1]!, p[i + 3]!, p[i + 4]!) <= reach) return true;
  }
  return false;
}

/** Einmal im App-Gerüst einbinden: zeigt den Browser-Editor, sobald `editInk` im Browser aufgerufen wird. */
export function InkEditorHost() {
  const req = useWebInkRequest();
  return req ? <WebInkEditor initial={req.doc} variant={req.variant} /> : null;
}

/** Handschrift-Editor für Browser (Laptop, Tablet im Browser); in der Android-App übernimmt InkEditorActivity. */
function WebInkEditor({ initial, variant }: { initial: InkDoc; variant: InkVariant }) {
  const [strokes, setStrokes] = useState<InkStroke[]>(initial.s);
  const [height, setHeight] = useState(initial.h);
  const [bg, setBg] = useState<InkBg>(initial.bg);
  const [tool, setTool] = useState<Tool>('pen');
  const [penColor, setPenColor] = useState(INK_COLORS[0]!);
  const [markerColor, setMarkerColor] = useState(INK_HIGHLIGHT_COLORS[0]!);
  const [penSize, setPenSize] = useState(1);
  const [markerSize, setMarkerSize] = useState(1);
  const [fingerDraws, setFingerDraws] = useState(false);
  const [, setRev] = useState(0);

  const undo = useRef<Op[]>([]);
  const redo = useRef<Op[]>([]);
  const dirty = useRef(false);
  const penSeen = useRef(false);

  const paper = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLDivElement>(null);
  const drawing = useRef<{ id: number; stroke: InkStroke; erased: { index: number; stroke: InkStroke }[]; erasing: boolean } | null>(null);
  const panning = useRef<{ id: number; y: number } | null>(null);
  const frame = useRef(0);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  const doc = useMemo<InkDoc>(() => ({ v: 1, w: initial.w, h: height, bg, s: strokes }), [initial.w, height, bg, strokes]);
  const svg = useMemo(() => inkSvg(doc, { paper: '#ffffff' }), [doc]);

  const close = useCallback(
    async (save: boolean) => {
      if (!save) {
        if (dirty.current && !(await confirmDialog('Änderungen an der Handschrift verwerfen?', { confirmLabel: 'Verwerfen', danger: true }))) return;
        finishWebInk(null);
        return;
      }
      finishWebInk({ doc });
    },
    [doc],
  );
  useOverlayClose(() => void close(true));

  useEffect(() => {
    document.body.classList.add('ink-open');
    return () => document.body.classList.remove('ink-open');
  }, []);

  const commit = (op: Op) => {
    undo.current.push(op);
    redo.current = [];
    dirty.current = true;
  };

  function doUndo() {
    const op = undo.current.pop();
    if (!op) return;
    redo.current.push(op);
    setStrokes((cur) => {
      if (op.kind === 'add') return cur.filter((s) => s !== op.stroke);
      const next = cur.slice();
      for (const it of [...op.items].sort((a, b) => a.index - b.index)) next.splice(Math.min(it.index, next.length), 0, it.stroke);
      return next;
    });
    dirty.current = true;
  }

  function doRedo() {
    const op = redo.current.pop();
    if (!op) return;
    undo.current.push(op);
    setStrokes((cur) => (op.kind === 'add' ? [...cur, op.stroke] : cur.filter((s) => !op.items.some((it) => it.stroke === s))));
    dirty.current = true;
  }

  const toDoc = (e: { clientX: number; clientY: number }) => {
    const r = paper.current!.getBoundingClientRect();
    const k = initial.w / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  };

  function renderLive() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const d = drawing.current;
      if (!d || !live.current) return;
      live.current.innerHTML = d.erasing ? '' : inkSvg({ ...doc, s: [d.stroke] }, { background: false });
    });
  }

  function addPoint(e: { clientX: number; clientY: number; pointerType: string; pressure: number }) {
    const d = drawing.current;
    if (!d) return;
    const { x, y } = toDoc(e);
    if (d.erasing) {
      const cur = strokesRef.current;
      const gone = new Set<number>();
      cur.forEach((s, i) => hits(s, x, y, ERASER_RADIUS) && gone.add(i));
      if (!gone.size) return;
      for (const i of gone) d.erased.push({ index: i, stroke: cur[i]! });
      const next = cur.filter((_, i) => !gone.has(i));
      strokesRef.current = next;
      setStrokes(next);
      return;
    }
    const pressure = e.pointerType === 'mouse' || e.pressure === 0 ? 0.5 : e.pressure;
    d.stroke.p.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(pressure * 100) / 100);
    if (variant === 'block' && y > height - 100 && height < INK_BLOCK_MAX_HEIGHT) setHeight((h) => Math.min(INK_BLOCK_MAX_HEIGHT, h + 240));
    renderLive();
  }

  function capture(e: React.PointerEvent) {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* Zeiger schon beendet – Zeichnen funktioniert auch ohne Erfassung */
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === 'pen') penSeen.current = true;
    const isTouch = e.pointerType === 'touch';
    if (isTouch && !fingerDraws) {
      if (drawing.current || panning.current) return;
      panning.current = { id: e.pointerId, y: e.clientY };
      capture(e);
      return;
    }
    if (drawing.current) return;
    e.preventDefault();
    capture(e);
    const erasing = tool === 'eraser' || (e.pointerType === 'pen' && (e.buttons & 32) !== 0);
    const marker = tool === 'marker';
    drawing.current = {
      id: e.pointerId,
      erasing,
      erased: [],
      stroke: {
        t: marker ? 'h' : 'p',
        c: marker ? markerColor : penColor,
        w: marker ? MARKER_SIZES[markerSize]! : PEN_SIZES[penSize]!,
        p: [],
      },
    };
    addPoint(e);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (panning.current?.id === e.pointerId) {
      scroller.current!.scrollTop -= e.clientY - panning.current.y;
      panning.current.y = e.clientY;
      return;
    }
    if (drawing.current?.id !== e.pointerId) return;
    const native = e.nativeEvent;
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const c of events.length ? events : [native]) addPoint(c);
  }

  function endPointer(e: React.PointerEvent) {
    if (panning.current?.id === e.pointerId) panning.current = null;
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    drawing.current = null;
    if (live.current) live.current.innerHTML = '';
    if (d.erasing) {
      if (d.erased.length) commit({ kind: 'remove', items: d.erased });
    } else if (d.stroke.p.length >= 3) {
      commit({ kind: 'add', stroke: d.stroke });
      setStrokes((cur) => [...cur, d.stroke]);
    }
    setRev((n) => n + 1);
  }

  const color = tool === 'marker' ? markerColor : penColor;
  const palette = tool === 'marker' ? INK_HIGHLIGHT_COLORS : INK_COLORS;
  const sizes = tool === 'marker' ? MARKER_SIZES : PEN_SIZES;
  const sizeIdx = tool === 'marker' ? markerSize : penSize;

  return (
    <div className="ink-ed" role="dialog" aria-modal="true" aria-label="Handschrift">
      <div className="ink-ed__bar">
        <button type="button" className="btn" onClick={() => void close(false)}>
          Verwerfen
        </button>
        <span className="ink-ed__spacer" />
        <button type="button" className="icon-btn" onClick={doUndo} disabled={!undo.current.length} aria-label="Rückgängig" title="Rückgängig">
          <Undo2 size={20} />
        </button>
        <button type="button" className="icon-btn" onClick={doRedo} disabled={!redo.current.length} aria-label="Wiederholen" title="Wiederholen">
          <Redo2 size={20} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            setBg(BGS[(BGS.indexOf(bg) + 1) % BGS.length]!);
            dirty.current = true;
          }}
          aria-label={`Hintergrund: ${BG_LABEL[bg]}`}
          title={`Hintergrund: ${BG_LABEL[bg]}`}
        >
          <Grid3x3 size={20} />
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void close(true)}>
          Fertig
        </button>
      </div>

      <div className="ink-ed__scroll" ref={scroller}>
        <div className="ink-ed__paper" ref={paper} style={{ aspectRatio: `${initial.w} / ${height}` }}>
          <div className="ink-ed__layer" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="ink-ed__layer" ref={live} />
          <div
            className="ink-ed__hit"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
      </div>

      <div className="ink-ed__tools" role="toolbar" aria-label="Werkzeuge">
        {(
          [
            ['pen', 'Stift', PenLine],
            ['marker', 'Textmarker', Highlighter],
            ['eraser', 'Radierer', Eraser],
          ] as const
        ).map(([id, label, Icon]) => (
          <button key={id} type="button" className="ed-tool" aria-pressed={tool === id} aria-label={label} title={label} onClick={() => setTool(id)}>
            <Icon size={20} />
          </button>
        ))}
        <span className="ed-toolbar__sep" aria-hidden />
        {tool !== 'eraser' && (
          <>
            {palette.map((c) => (
              <button
                key={c}
                type="button"
                className="ink-swatch"
                style={{ background: c }}
                aria-label={`Farbe ${c}`}
                aria-pressed={color === c}
                onClick={() => (tool === 'marker' ? setMarkerColor(c) : setPenColor(c))}
              />
            ))}
            <span className="ed-toolbar__sep" aria-hidden />
            {sizes.map((s, i) => (
              <button
                key={s}
                type="button"
                className="ed-tool"
                aria-pressed={sizeIdx === i}
                aria-label={`Stärke ${i + 1}`}
                onClick={() => (tool === 'marker' ? setMarkerSize(i) : setPenSize(i))}
              >
                <span className="ink-dot" style={{ width: 4 + i * 5, height: 4 + i * 5 }} />
              </button>
            ))}
          </>
        )}
        <span className="ed-toolbar__sep" aria-hidden />
        <button
          type="button"
          className="ed-tool"
          aria-pressed={fingerDraws}
          aria-label="Mit Finger zeichnen"
          title={fingerDraws ? 'Finger zeichnet' : 'Finger scrollt, Stift zeichnet'}
          onClick={() => setFingerDraws((v) => !v)}
        >
          <Hand size={20} />
        </button>
      </div>
    </div>
  );
}
