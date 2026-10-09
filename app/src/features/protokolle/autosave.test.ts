import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from './autosave';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createAutosave', () => {
  it('speichert nach der Wartezeit genau einmal, auch bei vielen Änderungen', async () => {
    const save = vi.fn(async () => {});
    const a = createAutosave(save, { delay: 500 });
    a.markDirty();
    await vi.advanceTimersByTimeAsync(300);
    a.markDirty();
    await vi.advanceTimersByTimeAsync(300);
    expect(save).not.toHaveBeenCalled(); // die zweite Änderung hat die Wartezeit neu gestartet
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
    expect(a.dirty).toBe(false);
  });

  it('schreibt nichts, wenn es keine Änderung gibt (Öffnen und Zurück darf ein Protokoll nicht verändern)', async () => {
    const save = vi.fn(async () => {});
    const a = createAutosave(save);
    await a.flushIfDirty();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(save).not.toHaveBeenCalled();
  });

  it('flushIfDirty speichert sofort, wenn etwas offen ist, und danach nicht noch einmal', async () => {
    const save = vi.fn(async () => {});
    const a = createAutosave(save, { delay: 500 });
    a.markDirty();
    await a.flushIfDirty();
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    await a.flushIfDirty();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('eine Änderung während des Speicherns wird danach nachgespeichert', async () => {
    let release: () => void = () => {};
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const a = createAutosave(save, { delay: 100 });
    a.markDirty();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    a.markDirty(); // tippt weiter, während der erste Lauf noch schreibt
    release();
    await vi.advanceTimersByTimeAsync(100);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(a.dirty).toBe(false);
  });

  it('meldet den Zustand nach außen (Speichert … / Gespeichert)', async () => {
    const events: string[] = [];
    const a = createAutosave(async () => {}, { delay: 100, onDirty: () => events.push('dirty'), onSaved: () => events.push('saved') });
    a.markDirty();
    await vi.advanceTimersByTimeAsync(100);
    expect(events).toEqual(['dirty', 'saved']);
  });

  it('cancel verwirft Offenes (zum Beispiel nach dem Löschen)', async () => {
    const save = vi.fn(async () => {});
    const a = createAutosave(save, { delay: 100 });
    a.markDirty();
    a.cancel();
    await vi.advanceTimersByTimeAsync(1_000);
    await a.flushIfDirty();
    expect(save).not.toHaveBeenCalled();
    expect(a.dirty).toBe(false);
  });

  it('nach einem Fehler bleibt die Änderung offen und wird beim nächsten Flush erneut versucht', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('voll')).mockResolvedValue(undefined);
    const a = createAutosave(save, { delay: 100 });
    a.markDirty();
    await vi.advanceTimersByTimeAsync(100);
    expect(a.dirty).toBe(true);
    await a.flushIfDirty();
    expect(save).toHaveBeenCalledTimes(2);
    expect(a.dirty).toBe(false);
  });
});
