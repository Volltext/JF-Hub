package de.jfhub.app;

import android.graphics.RectF;
import androidx.ink.brush.Brush;
import androidx.ink.brush.InputToolType;
import androidx.ink.brush.SelfOverlap;
import androidx.ink.brush.StockBrushes;
import androidx.ink.strokes.ImmutableStrokeInputBatch;
import androidx.ink.strokes.MutableStrokeInputBatch;
import androidx.ink.strokes.Stroke;
import androidx.ink.strokes.StrokeInput;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Handschrift-Dokument im selben Format wie src/features/ink/inkModel.ts:
 * {"v":1,"w":800,"h":1131,"bg":"lined","s":[{"t":"p","c":"#1b1d21","w":2.6,"p":[x,y,druck,...],"d":[ms,...],"u":cm}]}
 * Koordinaten sind Blatteinheiten (Blatt = w Einheiten breit), unabhängig von Bildschirm und Zoom.
 */
final class InkData {

    /** Ein Strich. `d` (Zeitabstände in ms) und `unitCm` sind optional und halten das Strichbild beim Wiederöffnen identisch. */
    static final class Item {
        boolean marker;
        int rgb;
        float width;
        /** x, y, Druck als Dreiergruppen. */
        float[] pts;
        /** Abstand zum vorigen Punkt in ms (gleich viele Werte wie Punkte) oder null. */
        int[] dt;
        float unitCm;
        RectF bounds;
        private Stroke stroke;

        /** Ink-Strich, beim ersten Zeichnen aus den Punkten aufgebaut. */
        Stroke stroke() {
            if (stroke == null) stroke = build();
            return stroke;
        }

        void setStroke(Stroke s) {
            stroke = s;
        }

        RectF bounds() {
            if (bounds == null) {
                float minX = Float.MAX_VALUE, minY = Float.MAX_VALUE, maxX = -Float.MAX_VALUE, maxY = -Float.MAX_VALUE;
                for (int i = 0; i + 2 < pts.length; i += 3) {
                    minX = Math.min(minX, pts[i]);
                    maxX = Math.max(maxX, pts[i]);
                    minY = Math.min(minY, pts[i + 1]);
                    maxY = Math.max(maxY, pts[i + 1]);
                }
                float pad = width * (marker ? 0.6f : 1f) + 1f;
                bounds = new RectF(minX - pad, minY - pad, maxX + pad, maxY + pad);
            }
            return bounds;
        }

        private Stroke build() {
            MutableStrokeInputBatch batch = new MutableStrokeInputBatch();
            long t = 0;
            int n = pts.length / 3;
            for (int i = 0; i < n; i++) {
                t += dt != null && i < dt.length ? dt[i] : 8;
                batch.add(
                        InputToolType.STYLUS,
                        pts[i * 3],
                        pts[i * 3 + 1],
                        t,
                        unitCm > 0 ? unitCm : StrokeInput.NO_STROKE_UNIT_LENGTH,
                        pts[i * 3 + 2],
                        StrokeInput.NO_TILT,
                        StrokeInput.NO_ORIENTATION);
            }
            return new Stroke(brush(marker, rgb, width), batch);
        }
    }

    float w = 800f;
    float h = 1131f;
    String bg = "none";
    final List<Item> items = new ArrayList<>();

    static Brush brush(boolean marker, int rgb, float size) {
        if (marker) {
            int argb = (0x61 << 24) | (rgb & 0xFFFFFF);
            return Brush.createWithColorIntArgb(StockBrushes.highlighter(SelfOverlap.DISCARD), argb, size, 0.1f);
        }
        return Brush.createWithColorIntArgb(StockBrushes.pressurePen(), 0xFF000000 | (rgb & 0xFFFFFF), size, 0.05f);
    }

    /** Übernimmt einen fertigen Ink-Strich (Punkte, Zeiten, Druck) in unser Format. */
    static Item fromStroke(Stroke stroke, boolean marker, int rgb, float width) {
        ImmutableStrokeInputBatch in = stroke.getInputs();
        int n = in.getSize();
        Item it = new Item();
        it.marker = marker;
        it.rgb = rgb;
        it.width = width;
        it.pts = new float[n * 3];
        it.dt = new int[n];
        StrokeInput tmp = new StrokeInput();
        long prev = 0;
        for (int i = 0; i < n; i++) {
            in.populate(i, tmp);
            it.pts[i * 3] = tmp.getX();
            it.pts[i * 3 + 1] = tmp.getY();
            it.pts[i * 3 + 2] = tmp.hasPressure() ? tmp.getPressure() : 0.5f;
            long ms = tmp.getElapsedTimeMillis();
            it.dt[i] = (int) Math.max(0, Math.min(2000, ms - prev));
            prev = ms;
        }
        it.unitCm = in.hasStrokeUnitLength() ? in.getStrokeUnitLengthCm() : 0f;
        it.setStroke(stroke);
        return it;
    }

    static InkData parse(String json) throws JSONException {
        JSONObject o = new JSONObject(json);
        InkData d = new InkData();
        d.w = (float) o.optDouble("w", 800);
        d.h = (float) o.optDouble("h", 1131);
        d.bg = o.optString("bg", "none");
        JSONArray s = o.optJSONArray("s");
        if (s == null) return d;
        for (int i = 0; i < s.length(); i++) {
            JSONObject so = s.optJSONObject(i);
            JSONArray p = so == null ? null : so.optJSONArray("p");
            if (p == null || p.length() < 3) continue;
            Item it = new Item();
            it.marker = "h".equals(so.optString("t"));
            it.width = (float) Math.max(0.3, Math.min(80, so.optDouble("w", 2.4)));
            try {
                it.rgb = 0xFFFFFF & android.graphics.Color.parseColor(so.optString("c", "#1b1d21"));
            } catch (IllegalArgumentException e) {
                it.rgb = 0x1b1d21;
            }
            int n = p.length() / 3;
            it.pts = new float[n * 3];
            for (int k = 0; k < n * 3; k++) it.pts[k] = (float) p.optDouble(k, 0);
            JSONArray d2 = so.optJSONArray("d");
            if (d2 != null && d2.length() >= n) {
                it.dt = new int[n];
                for (int k = 0; k < n; k++) it.dt[k] = Math.max(0, d2.optInt(k, 8));
            }
            it.unitCm = (float) so.optDouble("u", 0);
            d.items.add(it);
        }
        return d;
    }

    String toJson() {
        StringBuilder b = new StringBuilder(4096);
        b.append("{\"v\":1,\"w\":").append(num(w, 10)).append(",\"h\":").append(num(h, 10)).append(",\"bg\":\"").append(bg).append("\",\"s\":[");
        boolean first = true;
        for (Item it : items) {
            if (it.pts.length < 3) continue;
            if (!first) b.append(',');
            first = false;
            b.append("{\"t\":\"").append(it.marker ? 'h' : 'p').append("\",\"c\":\"").append(String.format("#%06x", it.rgb & 0xFFFFFF)).append("\",\"w\":").append(num(it.width, 100)).append(",\"p\":[");
            for (int i = 0; i + 2 < it.pts.length; i += 3) {
                if (i > 0) b.append(',');
                b.append(num(it.pts[i], 10)).append(',').append(num(it.pts[i + 1], 10)).append(',').append(num(it.pts[i + 2], 100));
            }
            b.append(']');
            if (it.dt != null) {
                b.append(",\"d\":[");
                for (int i = 0; i < it.dt.length; i++) {
                    if (i > 0) b.append(',');
                    b.append(it.dt[i]);
                }
                b.append(']');
            }
            if (it.unitCm > 0) b.append(",\"u\":").append(num(it.unitCm, 10000));
            b.append('}');
        }
        return b.append("]}").toString();
    }

    /** Auf `scale`-tel runden; Java schreibt Zahlen immer mit Punkt (kein Komma-Problem durch die Landeseinstellung). */
    private static String num(double v, int scale) {
        double r = Math.round(v * scale) / (double) scale;
        if (r == Math.rint(r) && Math.abs(r) < 1e9) return Long.toString((long) r);
        return Double.toString(r);
    }
}
