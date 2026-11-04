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
