import { useState } from 'react';
import { Camera, FileText, Image as ImageIcon, Paperclip, Rows3 } from 'lucide-react';
import type { Editor, JSONContent } from '@tiptap/core';
import { Sheet } from '@/core/ui/components';
import { putLocalBlob } from '@/core/db/blobs';
import { alertDialog } from '@/core/ui/dialog';
import { hideSnack, showSnack } from '@/core/ui/snackbar';
import { insertBlocks } from '@/features/protokolle/insertBlocks';
import { embedFile, embedKind, fileBlock } from './embed';
import { MAX_FILE_BYTES, formatBytes } from './limits';
import { photoToJpeg, pickFiles } from './pick';

type Kind = 'camera' | 'gallery' | 'file';
/** Dateien: sichtbar im Text (Bilder, PDF-Seiten) oder nur als Datei-Karte. */
export type FileMode = 'embed' | 'attach';

const PROGRESS_MS = 120_000;

/** Fotos aus Kamera und Galerie: immer als Bild im Text. */
async function photoBlocks(files: File[], skipped: string[]): Promise<JSONContent[]> {
  const out: JSONContent[] = [];
  for (const file of files) {
    try {
      if (file.size === 0) {
        skipped.push(`${file.name || 'Foto'}: leer`);
        continue;
      }
      const photo = await photoToJpeg(file);
      const blob = await putLocalBlob({ kind: 'photo', mime: 'image/jpeg', name: '', data: photo.data });
      out.push({ type: 'photo', attrs: { blobId: blob.id, mime: 'image/jpeg', w: photo.w, h: photo.h, caption: '' } }, { type: 'paragraph' });
    } catch (e) {
      skipped.push(`${file.name || 'Foto'}: ${e instanceof Error ? e.message : 'Fehler'}`);
    }
  }
  return out;
}

/**
 * Dateien: eingebettet (Bild bzw. PDF-Seiten im Text, die PDF zusätzlich als Karte) oder nur als Karte. Was sich nicht einbetten lässt,
 * wird Karte; die Hinweise dazu sammelt `notes`.
 */
async function fileBlocks(files: File[], mode: FileMode, skipped: string[], notes: string[]): Promise<JSONContent[]> {
  const out: JSONContent[] = [];
  for (const file of files) {
    const name = file.name || 'Datei';
    try {
      if (file.size === 0) {
        skipped.push(`${name}: leer`);
        continue;
      }
      const mime = file.type || 'application/octet-stream';
      const kind = mode === 'embed' ? embedKind(mime, name) : null;
      const tooBig = file.size > MAX_FILE_BYTES;
      // Ohne Einbetten ist eine zu große Datei gar nicht unterzubringen; eingebettet zählen nur die Seiten.
      if (tooBig && kind !== 'pdf') {
        skipped.push(`${name}: größer als ${formatBytes(MAX_FILE_BYTES)}`);
        continue;
      }
      const data = new Uint8Array(await file.arrayBuffer());
      const card = async () => fileBlock({ blobId: (await putLocalBlob({ kind: 'file', mime, name, data })).id, name, mime, size: file.size });
      if (!kind) {
        out.push(await card(), { type: 'paragraph' });
        continue;
      }
      try {
        const embedded = await embedFile({ name, mime, data }, (text) => showSnack(text, { duration: PROGRESS_MS }));
        out.push(...embedded.blocks);
        if (embedded.note) notes.push(embedded.note);
        if (kind === 'pdf') {
          if (tooBig) notes.push(`${name}: Die Seiten sind eingebettet. Die Datei selbst ist größer als ${formatBytes(MAX_FILE_BYTES)} und wurde nicht angehängt.`);
          else out.push(await card());
        }
        out.push({ type: 'paragraph' });
      } catch (e) {
        if (tooBig) {
          skipped.push(`${name}: ${e instanceof Error ? e.message : 'Fehler'}`);
          continue;
        }
        notes.push(`${name}: ${e instanceof Error ? e.message : 'Einbetten ging nicht.'} Die Datei ist als Anhang eingefügt.`);
        out.push(await card(), { type: 'paragraph' });
      }
    } catch (e) {
      skipped.push(`${name}: ${e instanceof Error ? e.message : 'Fehler'}`);
    }
  }
  return out;
}

/**
 * Legt Fotos und Dateien lokal ab und fügt Verweise auf sie ins Protokoll ein. Der Upload folgt beim nächsten Abgleich, noch vor dem
 * Protokoll selbst; bis dahin (auch offline) sind sie hier sofort zu sehen.
 */
export async function insertFiles(editor: Editor, kind: Kind, files: File[], mode: FileMode = 'attach'): Promise<void> {
  const skipped: string[] = [];
  const notes: string[] = [];
  let blocks: JSONContent[];
  try {
    blocks = kind === 'file' ? await fileBlocks(files, mode, skipped, notes) : await photoBlocks(files, skipped);
  } finally {
    hideSnack();
  }
  if (blocks.length && !editor.isDestroyed) insertBlocks(editor, blocks); // in einer Tabelle: dahinter
  const lines = [...notes, ...(skipped.length ? ['Nicht eingefügt:', ...skipped] : [])];
  if (lines.length) await alertDialog(lines.join('\n'), 'Anhang');
}

/** Auswahl: Foto aufnehmen, Foto aus der Galerie, Datei anhängen. Bei Bildern und PDFs danach: einbetten oder nur anhängen. */
export function AttachSheet({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [picked, setPicked] = useState<File[] | null>(null);

  function choose(kind: Kind) {
    // Die Auswahl muss direkt im Klick starten (Browser und Android verlangen eine Nutzeraktion).
    const files =
      kind === 'file'
        ? pickFiles({ accept: '*/*', multiple: true })
        : pickFiles({ accept: 'image/*', multiple: kind === 'gallery', capture: kind === 'camera' });
    if (kind !== 'file') {
      onClose();
      void files.then((list) => (list.length ? insertFiles(editor, kind, list) : undefined));
      return;
    }
    // Dateien: Lässt sich etwas einbetten, bleibt das Fenster für die Frage offen; sonst gleich als Anhang.
    void files.then((list) => {
      if (!list.length) return onClose();
      if (!list.some((f) => embedKind(f.type, f.name))) {
        onClose();
        void insertFiles(editor, 'file', list, 'attach');
        return;
      }
      setPicked(list);
    });
  }

  function place(mode: FileMode) {
    const list = picked ?? [];
    onClose();
    void insertFiles(editor, 'file', list, mode);
  }

  if (picked) {
    const pdfs = picked.filter((f) => embedKind(f.type, f.name) === 'pdf').length;
    const others = picked.filter((f) => !embedKind(f.type, f.name));
    return (
      <Sheet title="Wie einfügen?" onClose={onClose}>
        <p className="muted attach-files">{picked.map((f) => f.name || 'Datei').join(', ')}</p>
        <div className="list">
          <button type="button" className="toggle attach-mode" onClick={() => place('embed')} autoFocus>
            <Rows3 size={20} />
            <span>
              <strong>Im Protokoll einbetten</strong>
              <span className="muted">
                {pdfs ? 'Bilder und PDF-Seiten stehen sichtbar im Text und im PDF-Export. Die PDF bleibt zusätzlich angehängt.' : 'Das Bild steht sichtbar im Text und im PDF-Export.'}
              </span>
            </span>
          </button>
          <button type="button" className="toggle attach-mode" onClick={() => place('attach')}>
            <FileText size={20} />
            <span>
              <strong>Nur als Anhang</strong>
              <span className="muted">Als Datei-Karte im Text zum Öffnen und Teilen. Im PDF-Export steht nur der Dateiname.</span>
            </span>
          </button>
        </div>
        {others.length > 0 && (
          <p className="muted attach-files">
            {others.map((f) => f.name).join(', ')} {others.length === 1 ? 'lässt' : 'lassen'} sich nicht einbetten und {others.length === 1 ? 'kommt' : 'kommen'} in
            jedem Fall als Anhang dazu.
          </p>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet title="Anhang einfügen" onClose={onClose}>
      <div className="list">
        <button type="button" className="toggle" onClick={() => choose('camera')}>
          <Camera size={20} /> Foto aufnehmen
        </button>
        <button type="button" className="toggle" onClick={() => choose('gallery')}>
          <ImageIcon size={20} /> Foto aus Galerie / Dateien
        </button>
        <button type="button" className="toggle" onClick={() => choose('file')}>
          <Paperclip size={20} /> Datei anhängen (auch PDF)
        </button>
      </div>
    </Sheet>
  );
}
