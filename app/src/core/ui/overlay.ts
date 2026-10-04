import { useEffect, useRef } from 'react';
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
