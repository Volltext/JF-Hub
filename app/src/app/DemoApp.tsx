import { useEffect, useState } from 'react';
import { loadSettings } from '@/core/settings/settings';
import { applyTheme } from '@/core/ui/theme';
import { DemoBar } from '@/features/demo/DemoBar';
import { isDemoSeeded, seedDemo } from '@/features/demo/seed';
import { AppFrame } from './AppFrame';

/** Browser-Demo ohne Server: beim ersten Öffnen die Beispieldaten anlegen, dann gleich die ganze App – ohne Anmeldung. */
export function DemoApp() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    document.body.classList.add('web');
    void (async () => {
      applyTheme((await loadSettings()).theme);
      if (!(await isDemoSeeded())) await seedDemo();
      setReady(true);
    })();
  }, []);

  if (!ready) return null;
  return (
    <div className="web-frame">
      <DemoBar />
      <div className="web-frame__app">
        <AppFrame />
      </div>
    </div>
  );
}
