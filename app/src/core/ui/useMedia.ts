import { useSyncExternalStore } from 'react';

/** Folgt einer Media-Query (z. B. `(min-width: 1240px)`); ohne `matchMedia` (Tests) gilt `false`. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof matchMedia !== 'function') return () => undefined;
      const m = matchMedia(query);
      m.addEventListener('change', notify);
      return () => m.removeEventListener('change', notify);
    },
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
    () => false,
  );
}
