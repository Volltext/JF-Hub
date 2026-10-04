import { KeepAwake } from '@capacitor-community/keep-awake';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

/** Bildschirm wach halten (z. B. solange eine Stoppuhr läuft). Fehler sind unkritisch. */
export async function keepScreenOn(on: boolean): Promise<void> {
  try {
    if (on) await KeepAwake.keepAwake();
    else await KeepAwake.allowSleep();
  } catch {
    /* Im Browser oder ohne Unterstützung nicht verfügbar. */
  }
}

/** Kurzes Vibrationsfeedback für Start, Stopp und Marker. */
export async function tap(style: 'light' | 'medium' | 'heavy' = 'medium'): Promise<void> {
  try {
    await Haptics.impact({ style: ImpactStyle[style === 'light' ? 'Light' : style === 'heavy' ? 'Heavy' : 'Medium'] });
  } catch {
    /* Nicht verfügbar. */
  }
}
