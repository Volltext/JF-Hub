import { useEffect, useState } from 'react';
import { IS_DEMO } from '@/core/env';
import { mailApi } from './api';

const FLAG = 'jfh.mail.configured';
/** Ungelesene im Posteingang höchstens so oft beim Mail-Server erfragen (die Startseite wird oft geöffnet). */
const UNREAD_TTL = 2 * 60_000;
let cache: { at: number; unread: number } | null = null;

const readFlag = () => {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
};
const writeFlag = (on: boolean) => {
  try {
    if (on) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {
    /* privates Fenster: dann eben ohne Merker */
  }
};

/**
 * Für die Startseite: Ist ein Postfach eingerichtet, und wie viele Mails im Posteingang sind ungelesen?
 * Der zuletzt bekannte Stand wird gemerkt, damit die Kachel nicht erst nach der Serverantwort auftaucht.
 * Ohne Netz bleibt der gemerkte Stand stehen.
 */
export function useMailShortcut(): { configured: boolean; unread: number | null } {
  const [configured, setConfigured] = useState(() => !IS_DEMO && readFlag());
  const [unread, setUnread] = useState<number | null>(cache?.unread ?? null);

  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    void (async () => {
      try {
        const account = await mailApi.account();
        if (!alive) return;
        setConfigured(!!account);
        writeFlag(!!account);
        if (!account) return;
        if (cache && Date.now() - cache.at < UNREAD_TTL) return setUnread(cache.unread);
        const inbox = (await mailApi.folders()).find((f) => f.special === 'inbox' || f.path.toUpperCase() === 'INBOX');
        cache = { at: Date.now(), unread: inbox?.unseen ?? 0 };
        if (alive) setUnread(cache.unread);
      } catch {
        /* kein Netz oder E-Mail auf dem Server aus: gemerkten Stand behalten */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { configured, unread };
}
