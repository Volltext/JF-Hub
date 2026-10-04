package de.jfhub.app;

import android.graphics.RectF;
import com.google.mlkit.common.MlKitException;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognition;
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModel;
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModelIdentifier;
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizer;
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizerOptions;
import com.google.mlkit.vision.digitalink.recognition.Ink;
import com.google.mlkit.vision.digitalink.common.RecognitionResult;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Handschrift → Text mit ML Kit (läuft auf dem Gerät). Das Sprachmodell (Deutsch, einige MB) wird beim ersten Mal
 * einmalig heruntergeladen. ML Kit erkennt Zeilen; deshalb werden die Striche zuerst nach Zeilen gruppiert.
 */
final class InkRecognizer {

    interface Callback {
        void onProgress(String message);

        void onResult(String text);

        void onError(String message);
    }

    private InkRecognizer() {}

    static void recognize(InkData data, Callback cb) {
        final List<List<InkData.Item>> lines = segment(data.items);
        if (lines.isEmpty()) {
            cb.onResult("");
            return;
        }
        final DigitalInkRecognitionModel model;
        try {
            DigitalInkRecognitionModelIdentifier id = DigitalInkRecognitionModelIdentifier.fromLanguageTag("de-DE");
            if (id == null) id = DigitalInkRecognitionModelIdentifier.fromLanguageTag("de");
            if (id == null) {
                cb.onError("Deutsche Handschrifterkennung ist auf diesem Gerät nicht verfügbar.");
                return;
            }
            model = DigitalInkRecognitionModel.builder(id).build();
        } catch (MlKitException e) {
            cb.onError("Handschrifterkennung nicht verfügbar: " + e.getMessage());
            return;
        }

        final RemoteModelManager models = RemoteModelManager.getInstance();
        cb.onProgress("Handschrift wird erkannt …");
        models.isModelDownloaded(model)
                .addOnSuccessListener(
                        downloaded -> {
                            if (downloaded) {
                                run(model, lines, cb);
                                return;
                            }
                            cb.onProgress("Sprachmodell wird einmalig geladen (Internet nötig) …");
                            models.download(model, new DownloadConditions.Builder().build())
                                    .addOnSuccessListener(v -> run(model, lines, cb))
                                    .addOnFailureListener(e -> cb.onError("Das Sprachmodell konnte nicht geladen werden. Bitte mit dem Internet verbinden und erneut versuchen."));
                        })
                .addOnFailureListener(e -> cb.onError("Handschrifterkennung konnte nicht gestartet werden."));
    }

    private static void run(DigitalInkRecognitionModel model, List<List<InkData.Item>> lines, Callback cb) {
        final DigitalInkRecognizer recognizer = DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model).build());
        final StringBuilder out = new StringBuilder();
        nextLine(recognizer, lines, 0, out, cb);
    }

    private static void nextLine(DigitalInkRecognizer recognizer, List<List<InkData.Item>> lines, int i, StringBuilder out, Callback cb) {
        if (i >= lines.size()) {
            recognizer.close();
            cb.onResult(out.toString().trim());
            return;
        }
        recognizer
                .recognize(toInk(lines.get(i)))
                .addOnSuccessListener(
                        (RecognitionResult r) -> {
                            if (!r.getCandidates().isEmpty()) {
                                String t = r.getCandidates().get(0).getText().trim();
                                if (!t.isEmpty()) out.append(t).append('\n');
                            }
                            nextLine(recognizer, lines, i + 1, out, cb);
                        })
                .addOnFailureListener(
                        e -> {
                            recognizer.close();
                            cb.onError("Die Handschrift konnte nicht erkannt werden.");
                        });
    }

    private static Ink toInk(List<InkData.Item> line) {
        Ink.Builder ink = Ink.builder();
        long t = 0;
        for (InkData.Item it : line) {
            Ink.Stroke.Builder sb = Ink.Stroke.builder();
            int n = it.pts.length / 3;
            for (int i = 0; i < n; i++) {
                t += it.dt != null && i < it.dt.length ? Math.max(1, it.dt[i]) : 8;
                sb.addPoint(Ink.Point.create(it.pts[i * 3], it.pts[i * 3 + 1], t));
            }
            ink.addStroke(sb.build());
            t += 120; // kurze Pause zwischen Strichen
        }
        return ink.build();
    }

    /** Striche (ohne Textmarker) nach Zeilen gruppieren: überlappen sie senkrecht, gehören sie zur selben Zeile. */
    static List<List<InkData.Item>> segment(List<InkData.Item> items) {
        final class Line {
            float top = Float.MAX_VALUE;
            float bottom = -Float.MAX_VALUE;
            final List<InkData.Item> strokes = new ArrayList<>();

            void add(InkData.Item it, RectF b) {
                strokes.add(it);
                top = Math.min(top, b.top);
                bottom = Math.max(bottom, b.bottom);
            }
        }
        List<InkData.Item> pen = new ArrayList<>();
        for (InkData.Item it : items) if (!it.marker && it.pts.length >= 3) pen.add(it);
        final java.util.Map<InkData.Item, Integer> order = new java.util.IdentityHashMap<>();
        for (int i = 0; i < pen.size(); i++) order.put(pen.get(i), i);
        final List<InkData.Item> byTop = new ArrayList<>(pen);
        Collections.sort(byTop, (a, b) -> Float.compare(a.bounds().top, b.bounds().top));

        List<Line> lines = new ArrayList<>();
        for (InkData.Item it : byTop) {
            RectF b = it.bounds();
            Line target = null;
            for (Line l : lines) {
                float overlap = Math.min(l.bottom, b.bottom) - Math.max(l.top, b.top);
                float smaller = Math.min(l.bottom - l.top, b.bottom - b.top);
                float centre = (b.top + b.bottom) / 2f;
                if (overlap > 0.35f * smaller || (centre > l.top && centre < l.bottom)) {
                    target = l;
                    break;
                }
            }
            if (target == null) {
                target = new Line();
                lines.add(target);
            }
            target.add(it, b);
        }
        Collections.sort(lines, (a, b) -> Float.compare(a.top, b.top));

        List<List<InkData.Item>> out = new ArrayList<>();
        for (Line l : lines) {
            final List<InkData.Item> s = l.strokes;
            // Schreibreihenfolge innerhalb der Zeile
            Collections.sort(s, (a, b) -> Integer.compare(order.get(a), order.get(b)));
            out.add(s);
        }
        return out;
    }
}
