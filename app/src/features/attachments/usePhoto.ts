import { useEffect, useState } from 'react';
import { BlobUnavailable, ensureBlob, type Unavailable } from '@/features/protokolle/blobSync';

export type PhotoState = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'unavailable'; reason: Unavailable; message: string };

/**
 * Das Bild zu einem Foto-Anhang: aus dem lokalen Speicher, sonst vom Server (einmal, dann bleibt es auf dem Gerät).
 * Die Adresse gilt, solange die Anzeige da ist. Ist das Gerät offline, versucht es die Anzeige erneut, sobald wieder Netz da ist.
 */
export function usePhoto(blobId: string): { state: PhotoState; retry: () => void } {
  const [state, setState] = useState<PhotoState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    let url = '';
    setState({ status: 'loading' });
    ensureBlob({ id: blobId, kind: 'photo', mime: 'image/jpeg', name: '' })
      .then(({ data }) => {
        if (!alive) return;
        url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/jpeg' }));
        setState({ status: 'ready', url });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState({ status: 'unavailable', reason: e instanceof BlobUnavailable ? e.reason : 'error', message: e instanceof Error ? e.message : 'Das Foto konnte nicht geladen werden.' });
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blobId, attempt]);

  const offline = state.status === 'unavailable' && state.reason === 'offline';
  useEffect(() => {
    if (!offline) return;
    const again = () => setAttempt((n) => n + 1);
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [offline]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}
