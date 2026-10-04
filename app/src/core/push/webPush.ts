import { Capacitor } from '@capacitor/core';
import { db } from '@/core/db/db';
import { IS_WEB } from '@/core/env';
import { loadConn, request } from '@/features/protokolle/http';
import type { Reminder } from '@/core/domain/tasks';

/** Art der Erinnerung (wie in `core/native/notifications.ts`). */
export type PushKind = 'task' | 'service';

const ENDPOINT_KEY = 'push.endpoint';

/** Wohin das Antippen der Benachrichtigung führt. */
const TARGET: Record<PushKind, string> = {
  service: '/#/dienste?neu=1',
  task: '/#/aufgaben',
};

/**
 * Web-Push gibt es nur im Browser-Build (die Android-App plant ihre Erinnerungen selbst) und nur in einem
 * sicheren Kontext (https oder localhost). iOS verlangt zusätzlich, dass die App zum Home-Bildschirm hinzugefügt ist.
 */
export function pushSupported(): boolean {
  return (
    IS_WEB &&
    !Capacitor.isNativePlatform() &&
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** App ist installiert (Startbildschirm), nicht nur eine Browser-Seite. */
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/** Warum Push hier nicht geht (für die Anzeige), oder null. */
export function pushUnavailableReason(): string | null {
  if (!IS_WEB) return null;
  if (!window.isSecureContext) return 'Benachrichtigungen brauchen eine verschlüsselte Verbindung (https). Der Server ist hier nur über http erreichbar.';
  if (isIos() && !isStandalone()) return 'Auf dem iPhone/iPad: erst „Zum Home-Bildschirm“ hinzufügen und die App von dort öffnen.';
  if (!pushSupported()) return 'Dieser Browser unterstützt keine Benachrichtigungen.';
  if (Notification.permission === 'denied') return 'Benachrichtigungen sind für diese Seite blockiert (Browser-Einstellungen → Website-Berechtigungen).';
  return null;
}

/**
 * Der aktive Service Worker, oder null. `navigator.serviceWorker.ready` allein würde ewig warten, wenn keiner
 * registriert ist (z. B. Registrierung gescheitert) und damit das Abmelden blockieren.
 */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing?.active) return existing;
  // Gerade erst registriert: kurz auf die Aktivierung warten.
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  return (await registration())?.pushManager.getSubscription() ?? null;
}

/** Ist dieses Gerät für Push angemeldet (Erlaubnis erteilt und Abo vorhanden)? */
export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  return !!(await currentSubscription());
}

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Fragt die Erlaubnis ab und meldet dieses Gerät am Server an. Muss aus einer Nutzeraktion (Tippen) aufgerufen werden.
 * Liefert true, wenn Benachrichtigungen jetzt aktiv sind.
 */
export async function enablePush(): Promise<boolean> {
  if (pushUnavailableReason()) return false;
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const conn = await loadConn();
  const { publicKey } = await request<{ publicKey: string }>(conn, 'GET', '/api/push/key');
  const reg = await registration();
  if (!reg) throw new Error('Der Service Worker ist noch nicht aktiv. Bitte die Seite neu laden und es erneut versuchen.');
  let sub = await reg.pushManager.getSubscription();
  // Ein Abo, das mit einem anderen Server-Schlüssel erzeugt wurde (neue Datenbank), taugt nicht mehr.
  const known = sub?.options?.applicationServerKey;
  if (sub && known && btoa(String.fromCharCode(...new Uint8Array(known))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await request(conn, 'POST', '/api/push/subscribe', { subscription: sub.toJSON(), device: deviceLabel() });
  await db.kv.put({ key: ENDPOINT_KEY, value: sub.endpoint });
  return true;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows' : isIos() ? 'iOS' : /Mac/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'Browser';
  return `Web (${os})`;
}

/** Meldet dieses Gerät vom Push ab (Server und Browser). */
export async function removePushSubscription(): Promise<void> {
  if (!pushSupported()) return;
  const sub = await currentSubscription();
  if (sub) {
    const conn = await loadConn();
    await request(conn, 'POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  await db.kv.delete(ENDPOINT_KEY);
}

/**
 * Schickt dem Server die geplanten Erinnerungen dieser Art. Er verschickt sie zur gegebenen Zeit, auch wenn die App
 * geschlossen ist. Ohne Push-Anmeldung dieses Geräts passiert nichts.
 */
export async function syncWebReminders(reminders: Reminder[], kind: PushKind): Promise<void> {
  if (!(await pushEnabled())) return;
  const sub = await currentSubscription();
  if (!sub) return;
  await request(await loadConn(), 'PUT', '/api/push/reminders', {
    endpoint: sub.endpoint,
    kind,
    reminders: reminders.map((r) => ({ key: String(r.id), at: r.at.getTime(), title: r.title, body: r.body, url: TARGET[kind] })),
  });
}

/** Registriert den Service Worker (Web-Build, sicherer Kontext). */
export function registerServiceWorker(): void {
  if (!IS_WEB || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
  // Nach einem Update fehlen alte Dateien: einmal neu laden statt eines kaputten Bildschirms.
  window.addEventListener('vite:preloadError', () => window.location.reload());
}
