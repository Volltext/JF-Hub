export function formatDate(iso: string, long = false): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d).toLocaleDateString('de-DE', {
    weekday: long ? 'long' : 'short',
    day: '2-digit',
    month: long ? 'long' : '2-digit',
    year: 'numeric',
  });
}
