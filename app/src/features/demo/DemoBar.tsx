import { confirmDialog } from '@/core/ui/dialog';
import { seedDemo } from './seed';

/** Leiste über der Browser-Demo: wo die Daten liegen, Zurücksetzen, zurück zur Website. */
export function DemoBar() {
  async function reset() {
    if (!(await confirmDialog('Deine Änderungen gehen verloren, die Beispieldaten werden neu angelegt.', { title: 'Demo zurücksetzen?', confirmLabel: 'Zurücksetzen' }))) return;
    await seedDemo();
    window.location.reload();
  }
  return (
    <div className="demo-banner" role="note">
      <strong>Demo im Browser</strong> · Alles bleibt auf diesem Gerät.{' '}
      <button type="button" className="demo-banner__link" onClick={() => void reset()}>
        Zurücksetzen
      </button>
      {' · '}
      {/* Die Demo liegt im Ordner demo/ der Website. */}
      <a className="demo-banner__link" href="../">
        Über JF Hub
      </a>
    </div>
  );
}
