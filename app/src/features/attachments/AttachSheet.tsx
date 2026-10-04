import { Camera, Image as ImageIcon, Paperclip } from 'lucide-react';
import type { Editor } from '@tiptap/core';
import { Sheet } from '@/core/ui/components';
import { alertDialog } from '@/core/ui/dialog';
import { MAX_ATTACHMENT_CHARS, MAX_FILE_BYTES, attachmentChars, formatBytes } from './limits';
import { fileToBase64, photoToDataUrl, pickFiles } from './pick';

type Kind = 'camera' | 'gallery' | 'file';

async function insertAll(editor: Editor, kind: Kind, files: File[]): Promise<void> {
  let used = attachmentChars(editor.getJSON());
  const skipped: string[] = [];
  for (const file of files) {
    try {
      if (kind === 'file') {
        if (file.size > MAX_FILE_BYTES) {
          skipped.push(`${file.name}: größer als ${formatBytes(MAX_FILE_BYTES)}`);
          continue;
        }
        const data = await fileToBase64(file);
        if (used + data.length > MAX_ATTACHMENT_CHARS) {
          skipped.push(`${file.name}: Anhänge dieses Protokolls wären zu groß`);
          continue;
        }
        used += data.length;
        const attrs = { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, data };
        editor.chain().focus().insertContent([{ type: 'attachment', attrs }, { type: 'paragraph' }]).run();
      } else {
        const photo = await photoToDataUrl(file);
        if (used + photo.src.length > MAX_ATTACHMENT_CHARS) {
          skipped.push(`${file.name || 'Foto'}: Anhänge dieses Protokolls wären zu groß`);
          continue;
        }
        used += photo.src.length;
        const attrs = { src: photo.src, w: photo.w, h: photo.h, caption: '' };
        editor.chain().focus().insertContent([{ type: 'photo', attrs }, { type: 'paragraph' }]).run();
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
