import { useEffect } from 'react';
import type { Editor } from '@tiptap/core';
import { queueForProtocol, takePending } from './actions';
import { attachmentBlocks } from './toProtocol';

/**
 * Fügt Anhänge aus einer Mail, die für dieses Protokoll vorgemerkt wurden, am Ende des Textes ein, sobald der Editor bearbeitbar ist.
 * Die Vormerkung wird vorher gelöscht: Ein zweiter Aufruf (React im Entwicklungsmodus) fügt nichts doppelt ein.
 */
export function usePendingMailAttachments(editor: Editor | null, protocolId: string, editable: boolean): void {
  useEffect(() => {
    if (!editor || !editable) return;
    let alive = true;
    void takePending(protocolId).then((list) => {
      if (!alive || !list.length || editor.isDestroyed) {
        // Wurde der Effekt inzwischen beendet, geht nichts verloren: wieder vormerken.
        if (list.length) void queueForProtocol(protocolId, list);
        return;
      }
      editor.chain().insertContentAt(editor.state.doc.content.size, attachmentBlocks(list)).run();
    });
    return () => {
      alive = false;
    };
  }, [editor, editable, protocolId]);
}
