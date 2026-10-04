package de.jfhub.app;

import android.content.Context;
import android.graphics.Matrix;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.OverScroller;
import androidx.annotation.NonNull;
import androidx.ink.authoring.InProgressStrokeId;
import androidx.ink.authoring.InProgressStrokesFinishedListener;
import androidx.ink.authoring.InProgressStrokesView;
import androidx.ink.brush.Brush;
import androidx.ink.strokes.Stroke;
import androidx.input.motionprediction.MotionEventPredictor;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Zeichenfläche: Stift schreibt (Ink-API: Front-Buffer-Rendering, Vorhersage, Druck), Finger scrollt und zoomt,
 * Handballen werden ignoriert. Radierer, Textmarker, Rückgängig/Wiederholen.
 */
final class InkCanvas extends FrameLayout {

    enum Tool {
        PEN,
        MARKER,
        ERASER
    }

    interface Listener {
        /** Striche, Rückgängig-Stand oder Blattgröße haben sich geändert. */
        void onChanged();
    }

    static final float[] PEN_WIDTHS = {1.6f, 2.6f, 4.4f};
    static final float[] MARKER_WIDTHS = {16f, 24f, 34f};
    private static final float MAX_ZOOM = 6f;
    private static final float BLOCK_MAX_HEIGHT = 6000f;
    /** So lange nach dem letzten Stiftkontakt gelten Fingerberührungen als Handballen. */
    private static final long PALM_GUARD_MS = 900;

    private static final class Meta {
        final boolean marker;
        final int rgb;
        final float width;

        Meta(boolean marker, int rgb, float width) {
            this.marker = marker;
            this.rgb = rgb;
            this.width = width;
        }
    }

    private static final class Op {
        final boolean added;
        final List<InkData.Item> items = new ArrayList<>();
        final List<Integer> index = new ArrayList<>();

        Op(boolean added) {
            this.added = added;
        }
    }

    private final InkPageView page;
    private final InProgressStrokesView live;
    private final MotionEventPredictor predictor;
    private final ScaleGestureDetector scaler;
    private final GestureDetector gestures;
    private final OverScroller flinger;
    private final float density;
    private final float pad;

    private final Map<InProgressStrokeId, Meta> pending = new HashMap<>();
    private final ArrayDeque<Op> undoStack = new ArrayDeque<>();
    private final ArrayDeque<Op> redoStack = new ArrayDeque<>();

    private final Matrix worldToView = new Matrix();
    private final Matrix viewToWorld = new Matrix();
    private final float[] pt = new float[2];

    private InkData data = new InkData();
    private boolean growable;
    private Listener listener;

    // Werkzeug
    private Tool tool = Tool.PEN;
    private int penColor = 0x1b1d21;
    private int markerColor = 0xfdd835;
    private int penSize = 1;
    private int markerSize = 1;
    private boolean fingerDraws;

    // Ansicht
    private float fit = 1f;
    private float scale = 1f;
    private float tx;
    private float ty;
    private boolean viewReady;

    // Eingabe
    private int penPointer = -1;
    private InProgressStrokeId penStroke;
    private boolean erasing;
    private Op eraseOp;
    private boolean gestureMode;
    private boolean ignoreTouch;
    private long lastPenMs;
    private boolean dirty;

    InkCanvas(Context context) {
        super(context);
        density = context.getResources().getDisplayMetrics().density;
        pad = 12 * density;

        page = new InkPageView(context);
        live = new InProgressStrokesView(context);
        addView(page, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        addView(live, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        predictor = MotionEventPredictor.newInstance(this);
        flinger = new OverScroller(context);

        live.addFinishedStrokesListener(
                new InProgressStrokesFinishedListener() {
                    @Override
                    public void onStrokesFinished(@NonNull Map<InProgressStrokeId, Stroke> strokes) {
                        takeFinished(strokes);
                    }
                });

        scaler =
                new ScaleGestureDetector(
                        context,
                        new ScaleGestureDetector.SimpleOnScaleGestureListener() {
                            @Override
                            public boolean onScale(@NonNull ScaleGestureDetector d) {
                                zoomBy(d.getScaleFactor(), d.getFocusX(), d.getFocusY());
                                return true;
                            }
                        });
        gestures =
                new GestureDetector(
                        context,
                        new GestureDetector.SimpleOnGestureListener() {
                            @Override
                            public boolean onScroll(MotionEvent e1, @NonNull MotionEvent e2, float dx, float dy) {
                                if (scaler.isInProgress()) return true;
                                flinger.forceFinished(true);
                                tx -= dx;
                                ty -= dy;
                                applyTransform();
                                return true;
                            }

                            @Override
                            public boolean onFling(MotionEvent e1, @NonNull MotionEvent e2, float vx, float vy) {
                                if (scaler.isInProgress()) return false;
                                flinger.fling((int) tx, (int) ty, (int) vx, (int) vy, (int) minTx(), (int) maxTx(), (int) minTy(), (int) maxTy());
                                postInvalidateOnAnimation();
                                return true;
                            }

                            @Override
                            public boolean onDoubleTap(@NonNull MotionEvent e) {
                                float target = scale > fit * 1.05f ? fit : fit * 2.5f;
                                zoomBy(target / scale, e.getX(), e.getY());
                                return true;
                            }
                        });
    }

    // ---- Anbindung ----

    void bind(InkData d, boolean growsDownwards, Listener l) {
        data = d;
        growable = growsDownwards;
        listener = l;
        page.bind(d);
        viewReady = false;
        requestLayout();
    }

    InkData data() {
        syncPending();
        return data;
    }

    boolean hasStrokes() {
        syncPending();
        return !data.items.isEmpty();
    }

    String background() {
        return data.bg;
    }

    boolean hasChanges() {
        return dirty;
    }

    void setTool(Tool t) {
        tool = t;
    }

    Tool tool() {
        return tool;
    }

    void setColor(int rgb) {
        if (tool == Tool.MARKER) markerColor = rgb;
        else penColor = rgb;
    }

    int color() {
        return tool == Tool.MARKER ? markerColor : penColor;
    }

    void setSizeIndex(int i) {
        if (tool == Tool.MARKER) markerSize = i;
        else penSize = i;
    }

    int sizeIndex() {
        return tool == Tool.MARKER ? markerSize : penSize;
    }

    void setFingerDraws(boolean on) {
        fingerDraws = on;
    }

    void setBackgroundStyle(String bg) {
        data.bg = bg;
        dirty = true;
        page.invalidate();
        changed();
    }

    boolean canUndo() {
        return !undoStack.isEmpty();
    }

    boolean canRedo() {
        return !redoStack.isEmpty();
    }

    void setListener(Listener l) {
        listener = l;
    }

    private void changed() {
        if (listener != null) listener.onChanged();
    }

    // ---- Rückgängig ----

    void undo() {
        syncPending();
        Op op = undoStack.pollFirst();
        if (op == null) return;
        if (op.added) {
            data.items.removeAll(op.items);
        } else {
            // Entfernte Striche in umgekehrter Reihenfolge an ihren Platz zurücksetzen.
            for (int i = op.items.size() - 1; i >= 0; i--) data.items.add(Math.min(op.index.get(i), data.items.size()), op.items.get(i));
        }
        redoStack.addFirst(op);
        dirty = true;
        page.invalidate();
        changed();
    }

    void redo() {
        syncPending();
        Op op = redoStack.pollFirst();
        if (op == null) return;
        if (op.added) data.items.addAll(op.items);
        else data.items.removeAll(op.items);
        undoStack.addFirst(op);
        dirty = true;
        page.invalidate();
        changed();
    }

    private void push(Op op) {
        undoStack.addFirst(op);
        redoStack.clear();
        dirty = true;
        changed();
    }

    // ---- Fertige Striche aus der Ink-Ansicht übernehmen ----

    private void takeFinished(Map<InProgressStrokeId, Stroke> strokes) {
        Set<InProgressStrokeId> ids = new HashSet<>();
        boolean any = false;
        for (Map.Entry<InProgressStrokeId, Stroke> e : strokes.entrySet()) {
            ids.add(e.getKey());
            Meta m = pending.remove(e.getKey());
            if (m == null) continue; // schon übernommen oder abgebrochen
            Op op = new Op(true);
            op.items.add(InkData.fromStroke(e.getValue(), m.marker, m.rgb, m.width));
            data.items.addAll(op.items);
            undoStack.addFirst(op);
            any = true;
        }
        // Gleichzeitig mit dem Neuzeichnen entfernen, sonst flackert der Strich.
        live.removeFinishedStrokes(ids);
        page.invalidate();
        if (any) {
            redoStack.clear();
            dirty = true;
            changed();
        }
    }

    /** Striche, die noch nicht in die Liste übernommen wurden (kurze Wartezeit nach dem Absetzen), sofort übernehmen. */
    void syncPending() {
        Map<InProgressStrokeId, Stroke> m = live.getFinishedStrokes();
        if (!m.isEmpty()) takeFinished(new HashMap<>(m));
    }

    // ---- Zoom und Verschieben ----

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        if (w <= 0 || data.w <= 0) return;
        float zoom = viewReady ? scale / fit : 1f;
        fit = (w - 2 * pad) / data.w;
        scale = fit * zoom;
        if (!viewReady) {
            tx = pad;
            ty = pad;
            viewReady = true;
        }
        applyTransform();
    }

    private boolean narrow() {
        return data.w * scale + 2 * pad <= getWidth();
    }

    private float minTx() {
        return narrow() ? (getWidth() - data.w * scale) / 2f : getWidth() - data.w * scale - pad;
    }

    private float maxTx() {
        return narrow() ? (getWidth() - data.w * scale) / 2f : pad;
    }

    private float minTy() {
        return data.h * scale + 2 * pad <= getHeight() ? pad : getHeight() - data.h * scale - pad;
    }

    private float maxTy() {
        return pad;
    }

    private void applyTransform() {
        float cw = data.w * scale;
        float ch = data.h * scale;
        if (cw + 2 * pad <= getWidth()) tx = (getWidth() - cw) / 2f;
        else tx = Math.max(getWidth() - cw - pad, Math.min(pad, tx));
        if (ch + 2 * pad <= getHeight()) ty = pad;
        else ty = Math.max(getHeight() - ch - pad, Math.min(pad, ty));
        worldToView.setScale(scale, scale);
        worldToView.postTranslate(tx, ty);
        worldToView.invert(viewToWorld);
        page.setTransform(worldToView);
    }

    private void zoomBy(float factor, float fx, float fy) {
        float target = Math.max(fit, Math.min(fit * MAX_ZOOM, scale * factor));
        float f = target / scale;
        tx = fx - (fx - tx) * f;
        ty = fy - (fy - ty) * f;
        scale = target;
        applyTransform();
    }

    @Override
    public void computeScroll() {
        if (flinger.computeScrollOffset()) {
            tx = flinger.getCurrX();
            ty = flinger.getCurrY();
            applyTransform();
            postInvalidateOnAnimation();
        }
    }

    // ---- Eingabe ----

    private static boolean isPenTool(int type) {
        return type == MotionEvent.TOOL_TYPE_STYLUS || type == MotionEvent.TOOL_TYPE_ERASER || type == MotionEvent.TOOL_TYPE_MOUSE;
    }

    @Override
    public boolean onHoverEvent(MotionEvent e) {
        if (e.getPointerCount() > 0 && e.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS) lastPenMs = SystemClock.uptimeMillis();
        return super.onHoverEvent(e);
    }

    @Override
    public boolean onTouchEvent(MotionEvent ev) {
        predictor.record(ev);
        int action = ev.getActionMasked();
        int idx = ev.getActionIndex();

        switch (action) {
            case MotionEvent.ACTION_DOWN:
            case MotionEvent.ACTION_POINTER_DOWN:
                {
                    int type = ev.getToolType(idx);
                    if (isPenTool(type)) {
                        if (gestureMode) endGesture();
                        if (penPointer == -1) beginPen(ev, idx, type);
                        return true;
                    }
                    // Finger
                    if (penPointer != -1) return true; // Handballen während des Schreibens
                    if (!fingerDraws && SystemClock.uptimeMillis() - lastPenMs < PALM_GUARD_MS) {
                        ignoreTouch = true;
                        return true;
                    }
                    if (ignoreTouch) return true;
                    if (fingerDraws && ev.getPointerCount() == 1) {
                        beginPen(ev, idx, type);
                        return true;
                    }
                    if (penPointer != -1) cancelPen(ev); // zweiter Finger: Strich verwerfen, Geste beginnt
                    if (!gestureMode) {
                        gestureMode = true;
                        flinger.forceFinished(true);
                    }
                    return feedGesture(ev);
                }
            case MotionEvent.ACTION_MOVE:
                if (penPointer != -1) {
                    movePen(ev);
                    return true;
                }
                if (gestureMode) return feedGesture(ev);
                return true;
            case MotionEvent.ACTION_POINTER_UP:
                if (penPointer != -1 && ev.getPointerId(idx) == penPointer) {
                    endPen(ev);
                    return true;
                }
                if (gestureMode) return feedGesture(ev);
                return true;
            case MotionEvent.ACTION_UP:
                if (penPointer != -1) endPen(ev);
                else if (gestureMode) {
                    feedGesture(ev);
                    endGesture();
                }
                ignoreTouch = false;
                if (isPenTool(ev.getToolType(idx))) lastPenMs = SystemClock.uptimeMillis();
                return true;
            case MotionEvent.ACTION_CANCEL:
                if (penPointer != -1) cancelPen(ev);
                if (gestureMode) endGesture();
                ignoreTouch = false;
                return true;
            default:
                return true;
        }
    }

    private boolean feedGesture(MotionEvent ev) {
        boolean a = scaler.onTouchEvent(ev);
        boolean b = gestures.onTouchEvent(ev);
        return a || b;
    }

    private void endGesture() {
        gestureMode = false;
    }

    private void beginPen(MotionEvent ev, int idx, int type) {
        penPointer = ev.getPointerId(idx);
        lastPenMs = SystemClock.uptimeMillis();
        requestUnbufferedDispatch(ev);
        syncPending();
        boolean button = (ev.getButtonState() & MotionEvent.BUTTON_STYLUS_PRIMARY) != 0;
        erasing = tool == Tool.ERASER || type == MotionEvent.TOOL_TYPE_ERASER || button;
        if (erasing) {
            eraseOp = new Op(false);
            eraseAt(ev.getX(idx), ev.getY(idx));
            return;
        }
        boolean marker = tool == Tool.MARKER;
        int rgb = marker ? markerColor : penColor;
        float width = marker ? MARKER_WIDTHS[markerSize] : PEN_WIDTHS[penSize];
        Brush brush = InkData.brush(marker, rgb, width);
        penStroke = live.startStroke(ev, penPointer, brush, viewToWorld, new Matrix());
        pending.put(penStroke, new Meta(marker, rgb, width));
        grow(ev.getX(idx), ev.getY(idx));
    }

    private void movePen(MotionEvent ev) {
        int idx = ev.findPointerIndex(penPointer);
        if (idx < 0) return;
        lastPenMs = SystemClock.uptimeMillis();
        if (erasing) {
            for (int h = 0; h < ev.getHistorySize(); h++) eraseAt(ev.getHistoricalX(idx, h), ev.getHistoricalY(idx, h));
            eraseAt(ev.getX(idx), ev.getY(idx));
            return;
        }
        MotionEvent predicted = predictor.predict();
        try {
            live.addToStroke(ev, penPointer, penStroke, predicted);
        } finally {
            if (predicted != null) predicted.recycle();
        }
        grow(ev.getX(idx), ev.getY(idx));
    }

    private void endPen(MotionEvent ev) {
        if (erasing) {
            if (!eraseOp.items.isEmpty()) push(eraseOp);
            eraseOp = null;
            erasing = false;
        } else if (penStroke != null) {
            live.finishStroke(ev, penPointer, penStroke);
        }
        penPointer = -1;
        penStroke = null;
        lastPenMs = SystemClock.uptimeMillis();
    }

    private void cancelPen(MotionEvent ev) {
        if (erasing) {
            if (!eraseOp.items.isEmpty()) push(eraseOp);
            eraseOp = null;
            erasing = false;
        } else if (penStroke != null) {
            live.cancelStroke(penStroke, ev);
            pending.remove(penStroke);
        }
        penPointer = -1;
        penStroke = null;
    }

    /** Wächst die Zeichenfläche im Text nach unten, sobald man den unteren Rand erreicht. */
    private void grow(float viewX, float viewY) {
        if (!growable || data.h >= BLOCK_MAX_HEIGHT) return;
        pt[0] = viewX;
        pt[1] = viewY;
        viewToWorld.mapPoints(pt);
        if (pt[1] > data.h - 120f) {
            data.h = Math.min(BLOCK_MAX_HEIGHT, data.h + 280f);
            applyTransform();
            changed();
        }
    }

    // ---- Radierer ----

    private void eraseAt(float viewX, float viewY) {
        pt[0] = viewX;
        pt[1] = viewY;
        viewToWorld.mapPoints(pt);
        float r = 11f * density / scale;
        for (int i = data.items.size() - 1; i >= 0; i--) {
            InkData.Item it = data.items.get(i);
            RectF b = it.bounds();
            if (pt[0] < b.left - r || pt[0] > b.right + r || pt[1] < b.top - r || pt[1] > b.bottom + r) continue;
            if (!hit(it, pt[0], pt[1], r)) continue;
            data.items.remove(i);
            eraseOp.items.add(it);
            eraseOp.index.add(i);
            page.invalidate();
        }
    }

    private static boolean hit(InkData.Item it, float x, float y, float r) {
        float reach = r + it.width / 2f;
        float[] p = it.pts;
        if (p.length == 3) return Math.hypot(x - p[0], y - p[1]) <= reach;
        for (int i = 0; i + 5 < p.length; i += 3) {
            if (distToSegment(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= reach) return true;
        }
        return false;
    }

    private static double distToSegment(float px, float py, float ax, float ay, float bx, float by) {
        float dx = bx - ax;
        float dy = by - ay;
        float len2 = dx * dx + dy * dy;
        float t = len2 == 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }
}
