import { Preferences } from '@capacitor/preferences';

/**
 * Ablage für kleine Geheimnisse (PIN-Hash, Server-Token).
 * Preferences liegt app-privat; ein Keystore-Plugin kann hier später
 * eingesetzt werden, ohne dass sich die Aufrufer ändern.
 */
export const secure = {
  async get(key: string): Promise<string | null> {
    return (await Preferences.get({ key })).value;
  },
  async set(key: string, value: string): Promise<void> {
    await Preferences.set({ key, value });
  },
  async remove(key: string): Promise<void> {
    await Preferences.remove({ key });
  },
};
