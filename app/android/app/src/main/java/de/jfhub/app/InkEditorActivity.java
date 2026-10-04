package de.jfhub.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import org.json.JSONException;

/**
 * Vollbild-Handschrift: Stift schreibt mit der Android-Ink-API, Finger scrollt/zoomt, Handballen werden ignoriert.
 * Beim Beenden ("Fertig" oder Zurück) wird die Zeichnung gespeichert; "Verwerfen" bricht ab.
 */
public class InkEditorActivity extends AppCompatActivity {

    static final String EXTRA_IN = "in";
    static final String EXTRA_OUT = "out";
    static final String EXTRA_VARIANT = "variant";
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_TEXT_MODE = "textMode";

    private static final int BAR = 0xFF16181D;
    private static final int CHIP = 0xFF262A32;
    private static final int PRIMARY = 0xFFD42A22;
    private static final int[] PEN_COLORS = {0x1b1d21, 0xd32f2f, 0x1565c0, 0x2e7d32, 0xef6c00, 0x6a1b9a};
    private static final int[] MARKER_COLORS = {0xfdd835, 0x69f0ae, 0x40c4ff, 0xff80ab, 0xffab40};
    private static final String[] BGS = {"none", "lined", "grid", "dots"};
    private static final String[] BG_LABELS = {"Blanko", "Liniert", "Kariert", "Gepunktet"};

    private InkCanvas canvas;
    private String outPath;
    private float dp;

    private ImageButton undoBtn;
    private ImageButton redoBtn;
    private TextView bgBtn;
    private TextView penBtn;
    private TextView markerBtn;
    private TextView eraserBtn;
    private TextView fingerBtn;
    private LinearLayout paletteRow;
    private LinearLayout sizeRow;
    private AlertDialog busy;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        dp = getResources().getDisplayMetrics().density;

        String inPath = getIntent().getStringExtra(EXTRA_IN);
        outPath = getIntent().getStringExtra(EXTRA_OUT);
        boolean page = "page".equals(getIntent().getStringExtra(EXTRA_VARIANT));
        InkData data;
        try {
            data = InkData.parse(new String(Files.readAllBytes(Paths.get(inPath)), StandardCharsets.UTF_8));
        } catch (IOException | JSONException | RuntimeException e) {
            Toast.makeText(this, "Die Handschrift konnte nicht geöffnet werden.", Toast.LENGTH_LONG).show();
            setResult(Activity.RESULT_CANCELED);
            finish();
            return;
        }

        canvas = new InkCanvas(this);
        canvas.bind(data, !page, this::refresh);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BAR);
        root.addView(buildTopBar(), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(canvas, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(buildToolBar(), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(root);

        ViewCompat.setOnApplyWindowInsetsListener(
                root,
                (v, insets) -> {
                    Insets b = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                    v.setPadding(b.left, b.top, b.right, b.bottom);
                    return WindowInsetsCompat.CONSUMED;
                });
        WindowCompat.getInsetsController(getWindow(), root).setAppearanceLightStatusBars(false);
        WindowCompat.getInsetsController(getWindow(), root).setAppearanceLightNavigationBars(false);

        getOnBackPressedDispatcher()
                .addCallback(
                        this,
                        new OnBackPressedCallback(true) {
                            @Override
                            public void handleOnBackPressed() {
                                finishWith(null, null);
                            }
                        });

        // Gerät hat einen Stift? Dann scrollt der Finger, sonst zeichnet er.
        canvas.setFingerDraws(false);
        selectTool(InkCanvas.Tool.PEN);
        refresh();
    }

    // ---- Oberleiste ----

    private View buildTopBar() {
        LinearLayout bar = row();
        bar.setBackgroundColor(BAR);
        bar.setPadding(dp(6), dp(6), dp(6), dp(6));

        TextView discard = chip("Verwerfen", false);
        discard.setOnClickListener(v -> discard());
        bar.addView(discard);

        View spacer = new View(this);
        bar.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1f));

        undoBtn = iconButton(android.R.drawable.ic_menu_revert, "Rückgängig", false);
        undoBtn.setOnClickListener(v -> canvas.undo());
        redoBtn = iconButton(android.R.drawable.ic_menu_revert, "Wiederholen", true);
        redoBtn.setOnClickListener(v -> canvas.redo());
        bar.addView(undoBtn);
        bar.addView(redoBtn);

        bgBtn = chip("Blanko", false);
        bgBtn.setOnClickListener(
                v -> {
                    int i = 0;
                    for (int k = 0; k < BGS.length; k++) if (BGS[k].equals(canvas.background())) i = k;
                    canvas.setBackgroundStyle(BGS[(i + 1) % BGS.length]);
                });
        bar.addView(bgBtn);

        TextView text = chip("Aa", false);
        text.setContentDescription("Handschrift in Text umwandeln");
        text.setOnClickListener(v -> recognize());
        bar.addView(text);

        TextView done = chip("Fertig", true);
        done.setOnClickListener(v -> finishWith(null, null));
        bar.addView(done);
        return bar;
    }

    // ---- Werkzeugleiste ----

    private View buildToolBar() {
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setBackgroundColor(BAR);
        LinearLayout bar = row();
        bar.setPadding(dp(8), dp(6), dp(8), dp(6));
        scroll.addView(bar);

        penBtn = chip("Stift", false);
        penBtn.setOnClickListener(v -> selectTool(InkCanvas.Tool.PEN));
        markerBtn = chip("Marker", false);
        markerBtn.setOnClickListener(v -> selectTool(InkCanvas.Tool.MARKER));
        eraserBtn = chip("Radierer", false);
        eraserBtn.setOnClickListener(v -> selectTool(InkCanvas.Tool.ERASER));
        bar.addView(penBtn);
        bar.addView(markerBtn);
        bar.addView(eraserBtn);

        paletteRow = row();
        bar.addView(paletteRow);
        sizeRow = row();
        bar.addView(sizeRow);

        fingerBtn = chip("Finger scrollt", false);
        fingerBtn.setOnClickListener(
                v -> {
                    boolean on = fingerBtn.getTag() == null;
                    fingerBtn.setTag(on ? Boolean.TRUE : null);
                    canvas.setFingerDraws(on);
                    refresh();
                });
        bar.addView(fingerBtn);
        return scroll;
    }

    private void selectTool(InkCanvas.Tool t) {
        canvas.setTool(t);
        paletteRow.removeAllViews();
        sizeRow.removeAllViews();
        if (t != InkCanvas.Tool.ERASER) {
            int[] colors = t == InkCanvas.Tool.MARKER ? MARKER_COLORS : PEN_COLORS;
            for (int c : colors) paletteRow.addView(swatch(c));
            float[] sizes = t == InkCanvas.Tool.MARKER ? InkCanvas.MARKER_WIDTHS : InkCanvas.PEN_WIDTHS;
            for (int i = 0; i < sizes.length; i++) sizeRow.addView(sizeDot(i));
        }
        refresh();
    }

    /** Aktualisiert alle Schaltflächen nach Änderungen (Werkzeug, Rückgängig, Hintergrund …). */
    private void refresh() {
        if (canvas == null || undoBtn == null) return;
        setEnabled(undoBtn, canvas.canUndo());
        setEnabled(redoBtn, canvas.canRedo());
        InkCanvas.Tool t = canvas.tool();
        mark(penBtn, t == InkCanvas.Tool.PEN);
        mark(markerBtn, t == InkCanvas.Tool.MARKER);
        mark(eraserBtn, t == InkCanvas.Tool.ERASER);
        boolean finger = fingerBtn.getTag() != null;
        fingerBtn.setText(finger ? "Finger schreibt" : "Finger scrollt");
        mark(fingerBtn, finger);
        String bg = canvas.background();
        for (int i = 0; i < BGS.length; i++) if (BGS[i].equals(bg)) bgBtn.setText(BG_LABELS[i]);
        for (int i = 0; i < paletteRow.getChildCount(); i++) paletteRow.getChildAt(i).invalidate();
        for (int i = 0; i < sizeRow.getChildCount(); i++) sizeRow.getChildAt(i).invalidate();
    }

    // ---- Ergebnis ----

    private void finishWith(String text, String mode) {
        try {
            Files.write(Paths.get(outPath), canvas.data().toJson().getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            Toast.makeText(this, "Die Handschrift konnte nicht gespeichert werden.", Toast.LENGTH_LONG).show();
            return;
        }
        Intent result = new Intent();
        if (text != null) {
            result.putExtra(EXTRA_TEXT, text);
            result.putExtra(EXTRA_TEXT_MODE, mode);
        }
        setResult(Activity.RESULT_OK, result);
        finish();
    }

    private void discard() {
        if (!canvas.hasChanges()) {
            setResult(Activity.RESULT_CANCELED);
            finish();
            return;
        }
        new AlertDialog.Builder(this)
                .setMessage("Änderungen an der Handschrift verwerfen?")
                .setNegativeButton("Weiter schreiben", null)
                .setPositiveButton(
                        "Verwerfen",
                        (d, w) -> {
                            setResult(Activity.RESULT_CANCELED);
                            finish();
                        })
                .show();
    }

    // ---- Handschrift → Text ----

    private void recognize() {
        InkData data = canvas.data();
        if (!canvas.hasStrokes()) {
            Toast.makeText(this, "Es ist noch nichts geschrieben.", Toast.LENGTH_SHORT).show();
            return;
        }
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.HORIZONTAL);
        box.setGravity(Gravity.CENTER_VERTICAL);
        box.setPadding(dp(24), dp(20), dp(24), dp(8));
        box.addView(new ProgressBar(this));
        final TextView msg = new TextView(this);
        msg.setText("Handschrift wird erkannt …");
        msg.setPadding(dp(16), 0, 0, 0);
        msg.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        box.addView(msg);
        busy = new AlertDialog.Builder(this).setView(box).setCancelable(false).create();
        busy.show();

        InkRecognizer.recognize(
                data,
                new InkRecognizer.Callback() {
                    @Override
                    public void onProgress(String message) {
                        msg.setText(message);
                    }

                    @Override
                    public void onResult(String text) {
                        closeBusy();
                        if (text.isEmpty()) Toast.makeText(InkEditorActivity.this, "Es wurde keine Schrift erkannt.", Toast.LENGTH_LONG).show();
                        else showRecognized(text);
                    }

                    @Override
                    public void onError(String message) {
                        closeBusy();
                        Toast.makeText(InkEditorActivity.this, message, Toast.LENGTH_LONG).show();
                    }
                });
    }

    private void closeBusy() {
        if (busy != null && busy.isShowing()) busy.dismiss();
        busy = null;
    }

    private void showRecognized(String text) {
        final EditText edit = new EditText(this);
        edit.setText(text);
        edit.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        edit.setMinLines(3);
        edit.setGravity(Gravity.TOP);
        FrameLayout wrap = new FrameLayout(this);
        wrap.setPadding(dp(20), dp(8), dp(20), 0);
        wrap.addView(edit);
        new AlertDialog.Builder(this)
                .setTitle("Erkannter Text")
                .setView(wrap)
                .setPositiveButton("Unter Handschrift einfügen", (d, w) -> finishWith(edit.getText().toString().trim(), "insert"))
                .setNeutralButton("Handschrift ersetzen", (d, w) -> finishWith(edit.getText().toString().trim(), "replace"))
                .setNegativeButton("Abbrechen", null)
                .show();
    }

    @Override
    protected void onDestroy() {
        closeBusy();
        super.onDestroy();
    }

    // ---- kleine Bausteine ----

    private int dp(int v) {
        return Math.round(v * dp);
    }

    private LinearLayout row() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    private TextView chip(String label, boolean primary) {
        TextView t = new TextView(this);
        t.setText(label);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        t.setGravity(Gravity.CENTER);
        t.setMinHeight(dp(44));
        t.setMinWidth(dp(44));
        t.setPadding(dp(10), 0, dp(10), 0);
        t.setClickable(true);
        t.setFocusable(true);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(2), 0, dp(2), 0);
        t.setLayoutParams(lp);
        paint(t, primary ? PRIMARY : CHIP);
        return t;
    }

    private void paint(View v, int color) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(12));
        v.setBackground(g);
    }

    private void mark(TextView t, boolean on) {
        paint(t, on ? PRIMARY : CHIP);
    }

    private void setEnabled(View v, boolean on) {
        v.setEnabled(on);
        v.setAlpha(on ? 1f : 0.35f);
    }

    private ImageButton iconButton(int res, String description, boolean mirror) {
        ImageButton b = new ImageButton(this);
        b.setImageResource(res);
        b.setColorFilter(Color.WHITE);
        b.setContentDescription(description);
        b.setScaleX(mirror ? -1f : 1f);
        paint(b, CHIP);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(42), dp(44));
        lp.setMargins(dp(2), 0, dp(2), 0);
        b.setLayoutParams(lp);
        return b;
    }

    private View swatch(final int rgb) {
        View v =
                new View(this) {
                    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

                    @Override
                    protected void onDraw(Canvas c) {
                        float cx = getWidth() / 2f;
                        float cy = getHeight() / 2f;
                        p.setStyle(Paint.Style.FILL);
                        p.setColor(0xFF000000 | rgb);
                        c.drawCircle(cx, cy, dp(13), p);
                        boolean on = canvas != null && (canvas.color() & 0xFFFFFF) == rgb;
                        p.setStyle(Paint.Style.STROKE);
                        p.setStrokeWidth(dp(on ? 3 : 1));
                        p.setColor(on ? Color.WHITE : 0x55FFFFFF);
                        c.drawCircle(cx, cy, dp(on ? 17 : 13), p);
                    }
                };
        v.setContentDescription("Farbe");
        v.setOnClickListener(
                x -> {
                    canvas.setColor(rgb);
                    refresh();
                });
        v.setLayoutParams(new LinearLayout.LayoutParams(dp(42), dp(44)));
        return v;
    }

    private View sizeDot(final int index) {
        View v =
                new View(this) {
                    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

                    @Override
                    protected void onDraw(Canvas c) {
                        boolean on = canvas != null && canvas.sizeIndex() == index;
                        p.setColor(on ? Color.WHITE : 0xFF8A909B);
                        c.drawCircle(getWidth() / 2f, getHeight() / 2f, dp(3 + index * 3), p);
                    }
                };
        v.setContentDescription("Stärke " + (index + 1));
        v.setOnClickListener(
                x -> {
                    canvas.setSizeIndex(index);
                    refresh();
                });
        v.setLayoutParams(new LinearLayout.LayoutParams(dp(40), dp(44)));
        return v;
    }
}
