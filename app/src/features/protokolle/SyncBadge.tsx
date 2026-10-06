import { Cloud, CloudAlert, CloudOff, RefreshCw } from 'lucide-react';
import { IS_DEMO } from '@/core/env';
import { useSyncStatus, type SyncState } from './syncStatus';
import { syncNow } from './sync';

const INFO: Record<SyncState, { label: string; Icon: typeof Cloud }> = {
  off: { label: IS_DEMO ? 'Nur im Browser' : 'Kein Server', Icon: CloudOff },
  idle: { label: 'Synchron', Icon: Cloud },
  syncing: { label: 'Gleicht ab …', Icon: RefreshCw },
  offline: { label: 'Offline', Icon: CloudOff },
  auth: { label: 'Neu anmelden', Icon: CloudAlert },
  error: { label: 'Fehler', Icon: CloudAlert },
};

/** Zeigt den Abgleichsstatus; Antippen startet einen Abgleich. */
export function SyncBadge({ compact }: { compact?: boolean }) {
  const { state, message, lastSyncAt } = useSyncStatus();
  const { label, Icon } = INFO[state];
  const when = lastSyncAt ? ` · zuletzt ${new Date(lastSyncAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : '';
  const title = `${label}${when}${message ? ` – ${message}` : ''}`;
  return (
    <button
      type="button"
      className={`sync-badge sync-badge--${state}`}
      onClick={() => void syncNow()}
      disabled={state === 'syncing'}
      title={title}
      aria-label={`Server-Abgleich: ${title}. Tippen zum Abgleichen.`}
    >
      <Icon size={18} className={state === 'syncing' ? 'spin' : undefined} />
      {!compact && <span>{label}</span>}
    </button>
  );
}
