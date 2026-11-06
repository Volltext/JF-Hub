import { HashRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ReminderSync } from './ReminderSync';
import { DialogHost } from '@/core/ui/dialog';
import { SnackbarHost } from '@/core/ui/snackbar';
import { InkEditorHost } from '@/features/ink/WebInkEditor';
import { SyncHost } from '@/features/protokolle/SyncHost';

/** Die eigentliche App (Navigation, Seiten, Hintergrund-Abgleich) – gleich in Android-App und Browser. */
export function AppFrame() {
  return (
    <HashRouter>
      <ReminderSync />
      <SyncHost />
      <AppShell />
      <InkEditorHost />
      <SnackbarHost />
      <DialogHost />
    </HashRouter>
  );
}
