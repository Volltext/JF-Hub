import { useSyncExternalStore } from 'react';

/**
 * Einstellungen und Beobachtungen rund ums Schreiben, die zu *diesem Gerät* gehören (am Tablet mit Tastatur schreibt man anders
 * als am Handy): Autokorrektur an/aus, Protokoll-Liste neben dem Editor ein- oder ausgeblendet, und ob gerade eine echte Tastatur
 * benutzt wird. Gemerkt im Browser (localStorage), nicht im Konto.
 */

type Listener = () => void;

/** Ein An/Aus-Wert, im Browser gemerkt, mit React-Hook. Ohne Speicher (privates Fenster) gilt er bis zum Neuladen. */
function storedFlag(key: string, fallback: boolean) {
  const listeners = new Set<Listener>();
  let value: boolean | undefined;
  const get = (): boolean => {
    if (value === undefined) {
      try {
        const raw = localStorage.getItem(key);
        value = raw === null ? fallback : raw === '1';
      } catch {
        value = fallback;
      }
    }
    return value;
  };
  const set = (on: boolean) => {
    value = on;
    try {
      localStorage.setItem(key, on ? '1' : '0');
    } catch {
      /* privates Fenster: dann eben nur bis zum Neuladen */
    }
    for (const l of listeners) l();
  };
  const subscribe = (l: Listener) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const use = (): boolean => useSyncExternalStore(subscribe, get, () => fallback);
  return { get, set, use };
}

/** Autokorrektur im Protokoll-Editor (`autocorrect.ts`). */
export const autocorrectSetting = storedFlag('jfh.write.autocorrect', true);

/** Breite Ansicht: die Protokoll-Liste links ausblenden, damit der Text die ganze Breite bekommt. */
export const listHiddenSetting = storedFlag('jfh.write.listHidden', false);

/** Hinweis auf das falsche Tastaturlayout wurde weggeklickt. */
export const layoutHintDismissed = storedFlag('jfh.write.layoutHintDismissed', false);

// ---------------------------------------------------------------------------------------------------------------------
// Echte Tastatur am Touch-Gerät erkennen
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Am Tablet weiß die Seite nicht, ob eine Tastatur angeschlossen ist. Sie merkt es am ersten Tastendruck: Bildschirmtastaturen
 * unter Android melden Buchstaben als „Unidentified“ (keyCode 229), eine echte Tastatur meldet die Taste selbst. Dann zeigt
 * die App Tastenkürzel an. Am Rechner mit Maus gilt eine Tastatur als vorhanden.
 */
const kbdListeners = new Set<Listener>();
let hardware = false;
let qwertySignals = 0;
let qwertzSignals = 0;
let layoutWrong = false;
let installed = false;

/** Tasten, an denen sich das deutsche (QWERTZ) vom englischen Layout (QWERTY) unterscheidet: Position → [deutsch, englisch]. */
const LAYOUT_KEYS: Record<string, [string, string]> = {
  KeyY: ['z', 'y'],
  KeyZ: ['y', 'z'],
  Semicolon: ['ö', ';'],
  Quote: ['ä', "'"],
  BracketLeft: ['ü', '['],
  Minus: ['ß', '-'],
};

const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

function notify() {
  for (const l of kbdListeners) l();
}

/** Wertet einen Tastendruck aus (exportiert für Tests). */
export function observeKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'keyCode' | 'ctrlKey' | 'metaKey' | 'altKey'>): void {
  if (!e.key || e.key === 'Unidentified' || e.key === 'Process' || e.keyCode === 229) return;
  const printable = e.key.length === 1;
  if (!printable && !e.ctrlKey && !e.metaKey && !e.altKey) return;
  let changed = false;
  if (!hardware && (printable || e.ctrlKey || e.metaKey)) {
    hardware = true;
    document.documentElement.classList.add('hw-kbd');
    changed = true;
  }
  // Layout: Nur unter Android, wo eine angeschlossene Tastatur ohne Einstellung oft als „Englisch (US)“ läuft (y und z vertauscht, keine Umlaute).
  const pair = !e.ctrlKey && !e.metaKey && !e.altKey && e.code ? LAYOUT_KEYS[e.code] : undefined;
  if (pair && isAndroid()) {
    const key = e.key.toLocaleLowerCase('de-DE');
    if (key === pair[0]) qwertzSignals++;
    else if (key === pair[1]) qwertySignals++;
    const wrong = qwertySignals >= 4 && qwertzSignals === 0;
    if (wrong !== layoutWrong) {
      layoutWrong = wrong;
      changed = true;
    }
  }
  if (changed) notify();
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', (e) => e.isTrusted && observeKey(e), { capture: true, passive: true });
}

const kbdSubscribe = (l: Listener) => {
  install();
  kbdListeners.add(l);
  return () => kbdListeners.delete(l);
};

const finePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

/** Wird mit einer echten Tastatur geschrieben (oder ist es ein Rechner mit Maus)? */
export const typingWithKeyboard = (): boolean => {
  install();
  return hardware || finePointer();
};

export function useHardwareKeyboard(): boolean {
  return useSyncExternalStore(kbdSubscribe, typingWithKeyboard, () => false);
}

/** Tippt eine Tastatur unter Android im englischen Layout (y statt z, keine Umlaute)? */
export function useLayoutLooksWrong(): boolean {
  return useSyncExternalStore(kbdSubscribe, () => layoutWrong, () => false);
}

/** Nur für Tests: Erkennung zurücksetzen. */
export function resetKeyboardDetection(): void {
  hardware = false;
  qwertySignals = 0;
  qwertzSignals = 0;
  layoutWrong = false;
  if (typeof document !== 'undefined') document.documentElement.classList.remove('hw-kbd');
}

/** Ab dieser Breite stehen Protokoll-Liste und Editor nebeneinander (neben der Seitenleiste der App). */
export const SPLIT_QUERY = '(min-width: 1240px)';
