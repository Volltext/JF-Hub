import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { InkEditor } from '@/core/native/inkEditor';
import { emptyInk, fitBlockHeight, normalizeInk, roundInk, type InkDoc, type InkVariant } from './inkModel';

export interface InkEditOutcome {
  doc: InkDoc;
  /** Per Handschrifterkennung gewonnener Text. */
  text?: string;
  textMode?: 'insert' | 'replace';
}

interface WebRequest {
  doc: InkDoc;
  variant: InkVariant;
  resolve: (r: InkEditOutcome | null) => void;
}

let current: WebRequest | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useWebInkRequest(): WebRequest | null {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => current,
  );
}

export function finishWebInk(result: InkEditOutcome | null): void {
  const req = current;
  current = null;
  emit();
  req?.resolve(result);
}

/** Öffnet den Handschrift-Editor (nativ unter Android, sonst im Browser). null = abgebrochen. */
export async function editInk(doc: InkDoc | null, variant: InkVariant): Promise<InkEditOutcome | null> {
  const start = doc ?? emptyInk(variant);
  if (Capacitor.isNativePlatform()) {
    const r = await InkEditor.edit({ doc: JSON.stringify(start), variant });
    if (r.cancelled || !r.doc) return null;
    const parsed = normalizeInk(JSON.parse(r.doc));
    if (!parsed) return null;
    return { doc: finish(parsed, variant), text: r.text, textMode: r.textMode };
  }
  current?.resolve(null);
  return new Promise<InkEditOutcome | null>((resolve) => {
    current = {
      doc: start,
      variant,
      resolve: (r) => resolve(r && { ...r, doc: finish(r.doc, variant) }),
    };
    emit();
  });
}

function finish(doc: InkDoc, variant: InkVariant): InkDoc {
  const rounded = roundInk(doc);
  return variant === 'block' ? fitBlockHeight(rounded) : rounded;
}
