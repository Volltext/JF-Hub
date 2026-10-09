import { describe, expect, it } from 'vitest';
import { createPeers, PEER_TTL_MS } from './peers.js';

describe('Mitschreibende', () => {
  it('nennt andere, die das Protokoll innerhalb der Frist geöffnet hatten, ohne den Aufrufer', () => {
    const peers = createPeers();
    peers.touch('doc-1', 'anna', 1000);
    peers.touch('doc-1', 'ben', 2000);
    peers.touch('doc-2', 'cleo', 2000);
    expect(peers.list('doc-1', 'anna', 3000)).toEqual(['ben']);
    expect(peers.list('doc-1', 'ben', 3000)).toEqual(['anna']);
    expect(peers.list('doc-1', 'dora', 3000)).toEqual(['anna', 'ben']);
    expect(peers.list('doc-2', 'cleo', 3000)).toEqual([]);
    expect(peers.list('unbekannt', 'anna', 3000)).toEqual([]);
  });

  it('vergisst nach der Frist, und eine neue Meldung verlängert sie', () => {
    const peers = createPeers();
    peers.touch('doc-1', 'ben', 0);
    expect(peers.list('doc-1', 'anna', PEER_TTL_MS)).toEqual(['ben']);
    expect(peers.list('doc-1', 'anna', PEER_TTL_MS + 1)).toEqual([]);
    peers.touch('doc-1', 'ben', 10_000);
    expect(peers.list('doc-1', 'anna', 20_000)).toEqual(['ben']);
  });

  it('räumt Dokumente ab, die niemand mehr abfragt', () => {
    const peers = createPeers();
    for (let i = 0; i < 50; i++) peers.touch(`doc-${i}`, 'ben', 0);
    peers.touch('anderes', 'anna', 120_000); // löst den Durchgang aus
    expect(peers.list('doc-7', 'anna', 120_000)).toEqual([]);
    expect(peers.list('anderes', 'ben', 120_000)).toEqual(['anna']);
  });
});
