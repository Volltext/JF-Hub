import { Camera, Image as ImageIcon, Paperclip } from 'lucide-react';
import type { Editor } from '@tiptap/core';
import { Sheet } from '@/core/ui/components';
import { putLocalBlob } from '@/core/db/blobs';
import { alertDialog } from '@/core/ui/dialog';
import { insertBlocks } from '@/features/protokolle/insertBlocks';
import { MAX_FILE_BYTES, formatBytes } from './limits';
import { photoToJpeg, pickFiles } from './pick';

type Kind = 'camera' | 'gallery' | 'file';

/**
 * Legt Fotos und Dateien lokal ab und fügt Verweise auf sie ins Protokoll ein. Der Upload folgt beim nächsten Abgleich, noch vor dem
 * Protokoll selbst; bis dahin (auch offline) sind sie hier sofort zu sehen.
 */
async function insertAll(editor: Editor, kind: Kind, files: File[]): Promise<void> {
  const skipped: string[] = [];
  for (const file of files) {
    try {
      if (file.size === 0) {
        skipped.push(`${file.name || 'Datei'}: leer`);
        continue;
      }
      if (kind === 'file') {
        if (file.size > MAX_FILE_BYTES) {
          skipped.push(`${file.name}: größer als ${formatBytes(MAX_FILE_BYTES)}`);
          continue;
        }
        const mime = file.type || 'application/octet-stream';
        const blob = await putLocalBlob({ kind: 'file', mime, name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
        const attrs = { blobId: blob.id, name: file.name, mime, size: file.size };
        insertBlocks(editor, [{ type: 'attachment', attrs }, { type: 'paragraph' }]);
      } else {
        const photo = await photoToJpeg(file);
        const blob = await putLocalBlob({ kind: 'photo', mime: 'image/jpeg', name: '', data: photo.data });
        const attrs = { blobId: blob.id, mime: 'image/jpeg', w: photo.w, h: photo.h, caption: '' };
        insertBlocks(editor, [{ type: 'photo', attrs }, { type: 'paragraph' }]); // in einer Tabelle: dahinter
      }
    } catch (e) {
      skipped.push(`${file.name || 'Datei'}: ${e instanceof Error ? e.message : 'Fehler'}`);
    }
  }
  if (skipped.length) await alertDialog(`Nicht eingefügt:\n${skipped.join('\n')}`, 'Anhang');
}

/** Auswahl: Foto aufnehmen, Foto aus der Galerie, Datei anhängen. */
export function AttachSheet({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  function choose(kind: Kind) {
    // Die Auswahl muss direkt im Klick starten (Browser und Android verlangen eine Nutzeraktion).
    const picked =
      kind === 'file'
        ? pickFiles({ accept: '*/*', multiple: true })
        : pickFiles({ accept: 'image/*', multiple: kind === 'gallery', capture: kind === 'camera' });
    onClose();
    void picked.then((files) => (files.length ? insertAll(editor, kind, files) : undefined));
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
          <Paperclip size={20} /> Datei anhängen
        </button>
      </div>
    </Sheet>
  );
}
