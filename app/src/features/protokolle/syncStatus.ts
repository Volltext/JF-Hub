import { create } from 'zustand';

export type SyncState = 'off' | 'idle' | 'syncing' | 'offline' | 'auth' | 'error';

interface SyncStatus {
  state: SyncState;
  /** Zeitpunkt des letzten erfolgreichen Abgleichs (ms). */
  lastSyncAt: number | null;
  message: string;
  /** Anzahl Einträge auf dem Server laut letztem Abgleich. */
  counts: { protocols: number; folders: number; records: number } | null;
  set: (p: Partial<Omit<SyncStatus, 'set'>>) => void;
}

export const useSyncStatus = create<SyncStatus>((set) => ({
  state: 'off',
  lastSyncAt: null,
  message: '',
  counts: null,
  set: (p) => set(p),
}));
