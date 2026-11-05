import { useEffect, useRef, type RefObject } from 'react';
import { App as CapApp } from '@capacitor/app';

/** Offene Überlagerungen (Sheets, Dialoge) von unten nach oben. Zurück-Taste und Esc betreffen nur die oberste. */
const stack: symbol[] = [];

export function useOverlayClose(onClose: () => void): void {
  const ref = useRef(onClose);
  ref.current = onClose;

  useEffect(() => {
    const id = Symbol('overlay');
    stack.push(id);
    const isTop = () => stack[stack.length - 1] === id;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTop()) ref.current();
    };
    window.addEventListener('keydown', onKey);
    const back = CapApp.addListener('backButton', () => {
      if (isTop()) ref.current();
    });

    return () => {
      stack.splice(stack.indexOf(id), 1);
      window.removeEventListener('keydown', onKey);
      void back.then((h) => h.remove());
    };
  }, []);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * Hält den Tastaturfokus in einem Fenster (Sheet, Dialog) und gibt ihn beim Schließen an das auslösende Element zurück.
 * Verschachtelte Fenster: nur das innerste Fenster, in dem der Fokus steht, reagiert auf Tab.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>): void {
  // Beim ersten Rendern merken, wo der Fokus stand – vor einem autoFocus im Fenster.
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    if (!box.contains(document.activeElement)) box.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const target = e.target as Element | null;
      if (target && target.closest('[role="dialog"], [role="alertdialog"]') !== box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null && el.closest('[role="dialog"], [role="alertdialog"]') === box,
      );
      if (!items.length) return e.preventDefault();
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    box.addEventListener('keydown', onKey);
    const back = opener.current;
    return () => {
      box.removeEventListener('keydown', onKey);
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    };
  }, [ref]);
}
