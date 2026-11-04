import { useCallback, useEffect, useState } from 'react';
import { mailApi, type MailAccount } from './api';

export interface AccountState {
  /** `undefined` = lädt noch, `null` = kein Postfach eingerichtet. */
  account: MailAccount | null | undefined;
  error: string;
  reload: () => Promise<void>;
}

/** Das eigene Postfach laut Server. Fehler (kein Netz, E-Mail auf dem Server aus) kommen als Text. */
export function useMailAccount(): AccountState {
  const [account, setAccount] = useState<MailAccount | null | undefined>(undefined);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      setAccount(await mailApi.account());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { account, error, reload };
}
