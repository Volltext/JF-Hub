/** true im Browser-Build für den Laptop (`vite build --mode web`) und in der Browser-Demo: die App läuft im Browser. */
export const IS_WEB = import.meta.env.VITE_TARGET === 'web' || import.meta.env.VITE_TARGET === 'demo';

/**
 * Browser-Demo ohne Server (`vite build --mode demo`, auf der Website unter /demo/): keine Anmeldung, die Beispieldaten
 * liegen nur im Browser. Was der Server übernimmt (PDF, Benachrichtigungen, Abgleich), gibt es hier nicht.
 */
export const IS_DEMO = import.meta.env.VITE_TARGET === 'demo';

/** Meldung, wenn in der Browser-Demo etwas den Server braucht. */
export const DEMO_NEEDS_SERVER = 'Das übernimmt der JF-Hub-Server – in der Demo im Browser gibt es keinen. In einer eigenen Installation funktioniert es.';
