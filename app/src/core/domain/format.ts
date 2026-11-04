export function formatDate(iso: string, long = false): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d).toLocaleDateString('de-DE', {
    weekday: long ? 'long' : 'short',
    day: '2-digit',
    month: long ? 'long' : '2-digit',
    year: 'numeric',
  });
}

/** Kurz ohne Jahr („Do., 05.11.“): für enge Spalten, in denen das Jahr aus dem Zusammenhang klar ist. */
export function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

/** „Heute“, „Gestern“, sonst Wochentag mit Datum ohne Jahr (im laufenden Jahr) bzw. mit Jahr: so liest man eine Liste schneller. */
export function formatDateRelative(iso: string, today: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const days = Math.round((new Date(ty!, tm! - 1, td!).getTime() - new Date(y!, m! - 1, d!).getTime()) / 86400000);
  if (days === 0) return 'Heute';
  if (days === 1) return 'Gestern';
  if (days === -1) return 'Morgen';
  const date = new Date(y!, m! - 1, d!);
  return y === ty ? date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
