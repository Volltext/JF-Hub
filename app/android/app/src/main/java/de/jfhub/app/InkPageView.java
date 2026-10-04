package de.jfhub.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;
import androidx.ink.rendering.android.canvas.CanvasStrokeRenderer;

/** Zeichnet Papier, Blatthintergrund und alle fertigen Striche; Zoom und Verschieben kommen als Matrix von außen. */
final class InkPageView extends View {

    static final float GRID = 36f;

    private final CanvasStrokeRenderer renderer = CanvasStrokeRenderer.create(id -> null);
    private final Paint paper = new Paint();
    private final Paint rule = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint shadow = new Paint();
    private final Matrix worldToView = new Matrix();
    private final RectF visible = new RectF();
    private final Matrix inverse = new Matrix();
    private final RectF paperView = new RectF();
    private static final Matrix IDENTITY = new Matrix();

    private InkData data;

    InkPageView(Context context) {
        super(context);
        paper.setColor(Color.WHITE);
        shadow.setColor(0x33000000);
        rule.setColor(0xFFD5DAE2);
        rule.setStyle(Paint.Style.STROKE);
        rule.setStrokeCap(Paint.Cap.ROUND);
        setBackgroundColor(0xFF2B2E35);
    }

    void bind(InkData d) {
        data = d;
        invalidate();
    }

    void setTransform(Matrix m) {
        worldToView.set(m);
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        if (data == null) return;
        canvas.save();
        canvas.concat(worldToView);

        // Schatten und Papier
        float scale = scaleOf(worldToView);
        canvas.drawRect(-1 / scale, 2 / scale, data.w + 3 / scale, data.h + 4 / scale, shadow);
        canvas.drawRect(0, 0, data.w, data.h, paper);
        canvas.clipRect(0, 0, data.w, data.h);
        drawBackground(canvas, scale);
        canvas.restore();

        // Nur sichtbaren Bereich zeichnen (Blatteinheiten)
        worldToView.invert(inverse);
        visible.set(0, 0, getWidth(), getHeight());
        inverse.mapRect(visible);

        canvas.save();
        paperView.set(0, 0, data.w, data.h);
        worldToView.mapRect(paperView);
        canvas.clipRect(paperView);
        canvas.concat(worldToView);
        // Textmarker liegen unter der Schrift, damit sie nichts verdecken (wie in der SVG-Ausgabe).
        for (int pass = 0; pass < 2; pass++) {
            for (InkData.Item it : data.items) {
                if (it.marker != (pass == 0)) continue;
                if (!RectF.intersects(visible, it.bounds())) continue;
                renderer.draw(canvas, it.stroke(), IDENTITY);
            }
        }
        canvas.restore();
    }

    private void drawBackground(Canvas canvas, float scale) {
        switch (data.bg) {
            case "lined":
                rule.setStrokeWidth(1f);
                for (float y = GRID * 2; y < data.h; y += GRID) canvas.drawLine(0, y, data.w, y, rule);
                break;
            case "grid":
                rule.setStrokeWidth(0.8f);
                for (float y = GRID; y < data.h; y += GRID) canvas.drawLine(0, y, data.w, y, rule);
                for (float x = GRID; x < data.w; x += GRID) canvas.drawLine(x, 0, x, data.h, rule);
                break;
            case "dots":
                rule.setStrokeWidth(3f);
                for (float y = GRID; y < data.h; y += GRID) for (float x = GRID; x < data.w; x += GRID) canvas.drawPoint(x, y, rule);
                break;
            default:
        }
    }

    static float scaleOf(Matrix m) {
        float[] v = new float[9];
        m.getValues(v);
        return v[Matrix.MSCALE_X];
    }
}
