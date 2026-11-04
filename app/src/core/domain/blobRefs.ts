/** Kennungen aller Anhänge (`attrs.blobId`), auf die ein Protokolltext verweist. */
export function blobIdsIn(content: unknown): string[] {
  const out = new Set<string>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object' || Array.isArray(n)) return;
    const node = n as { attrs?: { blobId?: unknown }; content?: unknown };
    if (typeof node.attrs?.blobId === 'string' && node.attrs.blobId) out.add(node.attrs.blobId);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(content);
  return [...out];
}
