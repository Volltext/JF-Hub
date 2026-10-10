import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
const loadConn = vi.fn();
vi.mock('../http', async () => {
  const actual = await vi.importActual<typeof import('../http')>('../http');
  return { ...actual, loadConn: () => loadConn(), request: (...a: unknown[]) => request(...a) };
});

import { ProtoError } from '../http';
import { NoServer, httpExchange } from './wire';

const send = httpExchange(async () => 'E1');

beforeEach(() => {
  request.mockReset();
  loadConn.mockReset();
  loadConn.mockResolvedValue({ url: 'https://hub.example', token: 't' });
});

describe('httpExchange', () => {
  it('schickt die Kennung der Datenbank mit', async () => {
    request.mockResolvedValue({ docs: [] });
    await send({ docs: [{ id: 'a-000001' }] });
    expect(request).toHaveBeenCalledWith(expect.anything(), 'POST', '/api/collab/exchange', { docs: [{ id: 'a-000001' }], epoch: 'E1' }, false, expect.anything());
  });

  it('ohne Server oder Anmeldung gibt es nichts auszutauschen (kein Verbindungsfehler)', async () => {
    loadConn.mockResolvedValue({ url: '', token: null });
    await expect(send({ docs: [] })).rejects.toBeInstanceOf(NoServer);
    loadConn.mockResolvedValue({ url: 'https://hub.example', token: null });
    await expect(send({ docs: [] })).rejects.toBeInstanceOf(NoServer);
    expect(request).not.toHaveBeenCalled();
  });

  it('eine ersetzte Datenbank (409 mit reset) ist keine Störung, sondern die Aufforderung abzugleichen', async () => {
    request.mockRejectedValue(new ProtoError('Die Datenbank des Servers wurde ersetzt.', 409, false, { reset: true }));
    await expect(send({ docs: [] })).resolves.toEqual({ reset: true, docs: [] });
  });

  it('ein Server vor 3.0.0 kennt die Schnittstelle nicht: „Server zu alt“', async () => {
    request.mockRejectedValue(new ProtoError('Not Found', 404));
    await expect(send({ docs: [] })).rejects.toMatchObject({ status: 426, message: expect.stringContaining('zu alt') });
  });

  it('nimmt ein Proxy die Anfrage wegen ihrer Größe nicht an (413), sagt die Meldung, wo man nachsehen muss', async () => {
    request.mockRejectedValue(new ProtoError('Serverfehler 413.', 413));
    await expect(send({ docs: [] })).rejects.toMatchObject({ status: 413, message: expect.stringMatching(/Proxy.*Anfragegröße/) });
  });

  it('andere Fehler bleiben, wie sie sind', async () => {
    request.mockRejectedValue(new ProtoError('Keine Verbindung zum Server.', 0));
    await expect(send({ docs: [] })).rejects.toMatchObject({ status: 0 });
    request.mockRejectedValue(new ProtoError('Nicht angemeldet.', 401));
    await expect(send({ docs: [] })).rejects.toMatchObject({ status: 401 });
  });
});
