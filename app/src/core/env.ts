/** true im Browser-Build für den Laptop (`vite build --mode web`): nur Protokolle, gleicher Ursprung wie der Server. */
export const IS_WEB = import.meta.env.VITE_TARGET === 'web';
