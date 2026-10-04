import { useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { AppFrame } from './AppFrame';
import { LockScreen } from './LockScreen';
import { loadSettings } from '@/core/settings/settings';
import { pin } from '@/core/settings/pin';
import { applyTheme } from '@/core/ui/theme';
import { IS_WEB } from '@/core/env';
import { WebApp } from './WebApp';

type Phase = 'boot' | 'locked' | 'open';

function NativeApp() {
  const [phase, setPhase] = useState<Phase>('boot');

  useEffect(() => {
    void (async () => {
      applyTheme((await loadSettings()).theme);
      setPhase((await pin.isSet()) ? 'locked' : 'open');
    })();
  }, []);

  // Beim Wechsel in den Hintergrund sperren, sofern eine PIN gesetzt ist.
  useEffect(() => {
    const sub = CapApp.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive && (await pin.isSet())) setPhase('locked');
    });
    return () => void sub.then((h) => h.remove());
  }, []);

  if (phase === 'boot') return null;
  if (phase === 'locked') return <LockScreen onUnlock={() => setPhase('open')} />;
  return <AppFrame />;
}

/** Browser (PWA): Anmeldung, dann die ganze App; Android-App: optionale PIN, dann die ganze App. */
export function App() {
  return IS_WEB ? <WebApp /> : <NativeApp />;
}
