/**
 * Verzögertes Speichern für den Editor: sammelt Änderungen und schreibt erst nach einer kurzen Ruhepause.
 * Wichtig ist die Gegenseite: Ohne Änderung wird **nie** geschrieben. Wer ein Protokoll nur öffnet und wieder verlässt, setzt
 * sonst eine neue Änderungszeit, schickt das ganze Dokument (samt Fotos) an den Server und löst bei veröffentlichten
 * Protokollen unnötige Konflikte aus.
 */
export interface Autosave {
  /** Es gibt ungespeicherte Änderungen. */
  readonly dirty: boolean;
  /** Merkt eine Änderung vor und startet die Wartezeit neu. */
  markDirty(): void;
  /** Speichert sofort, wenn etwas offen ist; sonst passiert nichts. */
  flushIfDirty(): Promise<void>;
  /** Verwirft Offenes (zum Beispiel nach dem Löschen). */
  cancel(): void;
}

export interface AutosaveOptions {
  /** Wartezeit in ms (Standard 500). */
  delay?: number;
  /** Eine Änderung wurde vorgemerkt („Speichert …“). */
  onDirty?: () => void;
  /** Alles ist gespeichert („Gespeichert“). */
  onSaved?: () => void;
}

export function createAutosave(save: () => Promise<void>, opts: AutosaveOptions = {}): Autosave {
  const delay = opts.delay ?? 500;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  let dirty = false;

  const run = async (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    if (!dirty) return;
    dirty = false; // Änderungen während des Schreibens setzen es erneut
    const job = (async () => {
      try {
        await save();
      } catch (e) {
        dirty = true; // nicht verlieren: der nächste Flush versucht es wieder
        throw e;
      } finally {
        running = null;
      }
    })();
    running = job;
    await job;
    if (!dirty) opts.onSaved?.();
  };

  return {
    get dirty() {
      return dirty;
    },
    markDirty() {
      dirty = true;
      opts.onDirty?.();
      clearTimeout(timer);
      timer = setTimeout(() => void run().catch(() => undefined), delay);
    },
    async flushIfDirty() {
      if (running) await running.catch(() => undefined);
      await run();
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      dirty = false;
    },
  };
}
