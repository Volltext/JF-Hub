package de.jfhub.app;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * Öffnet den nativen Handschrift-Editor (InkEditorActivity) im Vollbild. Die Zeichnung geht als JSON über Dateien im
 * Cache (der Intent hat nur 1 MB Platz), das Ergebnis kommt als JSON-Text zurück.
 */
@CapacitorPlugin(name = "InkEditor")
public class InkEditorPlugin extends Plugin {

    private File inFile;
    private File outFile;

    @PluginMethod
    public void edit(PluginCall call) {
        String doc = call.getString("doc");
        if (doc == null) {
            call.reject("doc erforderlich");
            return;
        }
        String variant = "page".equals(call.getString("variant")) ? "page" : "block";
        try {
            File dir = getContext().getCacheDir();
            long stamp = System.nanoTime();
            inFile = new File(dir, "ink-" + stamp + "-in.json");
            outFile = new File(dir, "ink-" + stamp + "-out.json");
            Files.write(inFile.toPath(), doc.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            call.reject("Zeichnung konnte nicht übergeben werden: " + e.getMessage());
            return;
        }
        Intent intent = new Intent(getContext(), InkEditorActivity.class);
        intent.putExtra(InkEditorActivity.EXTRA_IN, inFile.getAbsolutePath());
        intent.putExtra(InkEditorActivity.EXTRA_OUT, outFile.getAbsolutePath());
        intent.putExtra(InkEditorActivity.EXTRA_VARIANT, variant);
        startActivityForResult(call, intent, "editResult");
    }

    @ActivityCallback
    private void editResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        try {
            Intent data = result.getData();
            if (result.getResultCode() == Activity.RESULT_OK && data != null && outFile != null && outFile.exists()) {
                ret.put("cancelled", false);
                ret.put("doc", new String(Files.readAllBytes(outFile.toPath()), StandardCharsets.UTF_8));
                String text = data.getStringExtra(InkEditorActivity.EXTRA_TEXT);
                if (text != null && !text.isEmpty()) {
                    ret.put("text", text);
                    ret.put("textMode", data.getStringExtra(InkEditorActivity.EXTRA_TEXT_MODE));
                }
            } else {
                ret.put("cancelled", true);
            }
        } catch (IOException e) {
            call.reject("Ergebnis konnte nicht gelesen werden: " + e.getMessage());
            return;
        } finally {
            if (inFile != null) inFile.delete();
            if (outFile != null) outFile.delete();
        }
        call.resolve(ret);
    }
}
