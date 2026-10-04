import { registerPlugin } from '@capacitor/core';

export interface InkEditorEditOptions {
  /** InkDoc als JSON-Text (Format: features/ink/inkModel.ts). */
  doc: string;
  variant: 'block' | 'page';
  title?: string;
}

export interface InkEditorEditResult {
  cancelled: boolean;
  /** Bearbeitete Zeichenfläche als JSON-Text (fehlt bei cancelled). */
  doc?: string;
  /** Erkannter Text, falls der Nutzer „Als Text einfügen“ gewählt hat. */
  text?: string;
  textMode?: 'insert' | 'replace';
}

/** Schnittstelle zu android/app/src/main/java/de/jfhub/app/InkEditorPlugin.java (Vollbild-Handschrift mit Android-Ink-API). */
export interface InkEditorPlugin {
  edit(options: InkEditorEditOptions): Promise<InkEditorEditResult>;
}

export const InkEditor = registerPlugin<InkEditorPlugin>('InkEditor');
