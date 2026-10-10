import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HubDb } from '@/core/db/db';
import { newProtokoll, type Protokoll } from '../model';
import { ANNA, TestServer, closeDevices, newDevice, textOf } from './harness';
import { openProtocol, planOpen, type Opened } from './openPlan';
import { canonicalJson, jsonToYDoc } from '../../../../../server/src/collab/convert';
import { yDocToJson } from './yJson';
import { ProtoError } from '../http';
import type { ExchangeTransport } from './wire';

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: object[]) => ({ type: 'doc', content }) as never;
const row = (over: Partial<Protokoll> = {}): Protokoll => ({ ...newProtokoll(), dirty: 0, rev: 3, content: doc(para('Text')), ...over });

describe('planOpen', () => {
  it.each([
    ['gibt es nicht', undefined, false, true, 'gone'],
    ['im Papierkorb', row({ deleted: 1 }), false, true, 'gone'],
    ['vom Server noch nicht umgestellt', row({ legacy: true }), false, true, 'legacy'],
    ['Zustand vorhanden', row(), true, true, 'bind'],
    ['Zustand vorhanden, Server nicht umgestellt: lesen', row({ legacy: true }), true, true, 'legacy'],
    ['ohne Inhalt, nie gesendet', row({ rev: 0, content: doc({ type: 'paragraph' }) }), false, true, 'empty'],
    ['ohne Inhalt, dem Server bekannt: der Server hat womöglich Text, der erste Austausch holt ihn', row({ content: doc() }), false, true, 'empty'],
    ['mit Inhalt, nie gesendet (aus 2.3.0)', row({ rev: 0 }), false, true, 'base'],
    ['mit Inhalt, dem Server bekannt: Zustand holen, nie selbst eine Basis bauen', row({ rev: 3 }), false, true, 'fetch'],
    ['mit Inhalt, kein Server eingerichtet (Demo, Android ohne Server)', row({ rev: 1 }), false, false, 'base'],
  ])('%s', (_name, protokoll, hasState, hasServer, expected) => {
    expect(planOpen(protokoll, hasState, hasServer)).toBe(expected);
  });
});

describe('openProtocol', () => {
  let server: TestServer;
  let store: HubDb;
  beforeEach(() => {
    server = new TestServer();
    store = newDevice('open');
  });
  afterEach(async () => {
    await closeDevices();
  });

  const deps = (transport: ExchangeTransport = server.transport(ANNA), hasServer = true) => ({ store, transport, hasServer: async () => hasServer });
  const edit = (o: Opened) => {
    if (o.kind !== 'edit') throw new Error(`nicht zu öffnen: ${o.reason}`);
    return o.session;
  };

  it('ohne Inhalt: ein leeres Dokument, nichts wird gespeichert, kein Austausch', async () => {
    const p = row({ rev: 0, content: doc({ type: 'paragraph' }) });
    await store.protokolle.add(p);
    const s = edit(await openProtocol(p.id, deps()));
    expect(s.doc.getXmlFragment('body').length).toBe(0);
    await s.destroy();
    expect(await store.ydocs.count()).toBe(0);
    expect(server.exchanges).toHaveLength(0);
  });

  it('nie gesendet, Inhalt aus der Zeit vor 3.0.0: die Basis entsteht auf dem Gerät und wird für den Server vorgemerkt', async () => {
    const content = doc(
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Titel' }] },
      para('Absatz'),
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [para('Zelle')] }] }] },
      { type: 'photo', attrs: { blobId: 'foto-0001', mime: 'image/jpeg', w: 4, h: 3, caption: 'Teich' } },
    );
    const p = row({ rev: 0, content });
    await store.protokolle.add(p);
    const s = edit(await openProtocol(p.id, deps()));
    expect(canonicalJson(yDocToJson(s.doc))).toBe(canonicalJson(content));
    expect(await store.ydocs.get(p.id)).toMatchObject({ dirty: 1, created: true });
    await s.destroy();
    // Öffnen und Schließen hat nichts verändert, was der Server noch nicht kennt
    expect(await store.ydocs.get(p.id)).toMatchObject({ dirty: 1, created: true, seq: 1 });
  });

  it('zweimal geöffnet bleibt es bei einer Basis (zwei Basen desselben Inhalts würden ihn verdoppeln)', async () => {
    const p = row({ rev: 0, content: doc(para('Einmal')) });
    await store.protokolle.add(p);
    edit(await openProtocol(p.id, deps()));
    const first = (await store.ydocs.get(p.id))!.update;
    edit(await openProtocol(p.id, deps()));
    expect(Buffer.from((await store.ydocs.get(p.id))!.update).equals(Buffer.from(first))).toBe(true);
  });

  it('dem Server bekannt, kein lokaler Zustand: holt den Zustand und baut nie selbst eine Basis', async () => {
    const id = server.put({ id: 'doc-00001', ownerId: ANNA.id, shared: true, content: doc(para('Vom Server')) });
    await store.protokolle.add(row({ id, rev: server.row(id)!.rev, content: doc(para('Vom Server')) }));
    const s = edit(await openProtocol(id, deps()));
    expect(textOf(s.doc)).toBe('Vom Server');
    expect(await store.ydocs.get(id)).toMatchObject({ dirty: 0 });
    expect((await store.protokolle.get(id))!.textRev).toBe(server.row(id)!.rev);
    expect(server.exchanges[0]!.docs[0]).toEqual({ id }); // nur gefragt, nichts gesendet
  });

  it('offline und ohne lokalen Zustand: nur lesen, mit Hinweis', async () => {
    const id = server.put({ id: 'doc-00001', ownerId: ANNA.id, shared: true, content: doc(para('Text')) });
    await store.protokolle.add(row({ id, rev: 5 }));
    server.offline = true;
    const o = await openProtocol(id, deps());
    expect(o).toMatchObject({ kind: 'readonly', reason: 'needs-server' });
    expect(await store.ydocs.count()).toBe(0);
  });

  it('der Server sagt „gone“, „legacy“ oder gibt keine Auskunft: nur lesen, ohne etwas zu speichern', async () => {
    const id = 'doc-00001';
    await store.protokolle.add(row({ id, rev: 5 }));
    const stub = (status: string): ExchangeTransport => async () => ({ docs: [{ id, status: status as never }] });
    expect(await openProtocol(id, deps(stub('gone')))).toMatchObject({ kind: 'readonly', reason: 'gone' });
    expect(await openProtocol(id, deps(stub('legacy')))).toMatchObject({ kind: 'readonly', reason: 'legacy' });
    expect(await openProtocol(id, deps(stub('deferred')))).toMatchObject({ kind: 'readonly', reason: 'needs-server' });
    expect(await openProtocol(id, deps(async () => ({ reset: true, docs: [] })))).toMatchObject({ kind: 'readonly', reason: 'needs-server' });
    expect(await store.ydocs.count()).toBe(0);
  });

  it('ohne Server (Demo, Android ohne Server) bekommt auch ein Protokoll mit Revision seine Basis aus dem Schnappschuss', async () => {
    const p = row({ rev: 1, content: doc(para('Demo-Text')) });
    await store.protokolle.add(p);
    const failing: ExchangeTransport = async () => {
      throw new ProtoError('Kein Server eingerichtet.', 0);
    };
    const s = edit(await openProtocol(p.id, deps(failing, false)));
    expect(textOf(s.doc)).toBe('Demo-Text');
  });

  it('ein Zustand mit Elementen, die diese App nicht kennt, wird nie gebunden (der Editor würde sie für alle löschen)', async () => {
    const p = row();
    await store.protokolle.add(p);
    const foreign = new Y.Doc();
    foreign.getXmlFragment('body').push([new Y.XmlElement('callout')]);
    await store.ydocs.put({ id: p.id, update: Y.encodeStateAsUpdate(foreign), dirty: 0, seq: 0 });
    const o = await openProtocol(p.id, deps());
    expect(o).toMatchObject({ kind: 'readonly', reason: 'unreadable' });
    expect((o as { message: string }).message).toContain('callout');
    expect(await store.ydocs.get(p.id)).toMatchObject({ seq: 0, dirty: 0 }); // unberührt
  });

  it('ein Zustand, der gegen die Inhaltsregeln verstößt (gleichzeitig leer gestrichene Liste), wird beim Öffnen repariert und für den Server vorgemerkt', async () => {
    const p = row();
    await store.protokolle.add(p);
    const broken = jsonToYDoc({ type: 'doc', content: [para('davor'), { type: 'bulletList' }, para('danach')] } as never);
    await store.ydocs.put({ id: p.id, update: Y.encodeStateAsUpdate(broken), dirty: 0, seq: 0 });
    const s = edit(await openProtocol(p.id, deps()));
    expect(yDocToJson(s.doc)).toEqual({
      type: 'doc',
      content: [para('davor'), { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }, para('danach')],
    });
    // die Ergänzung ist eine Änderung dieses Geräts: gesichert und zum Server unterwegs
    const saved = await store.ydocs.get(p.id);
    expect(saved).toMatchObject({ dirty: 1 });
    const again = new Y.Doc();
    Y.applyUpdate(again, saved!.update);
    expect(canonicalJson(yDocToJson(again))).toBe(canonicalJson(yDocToJson(s.doc)));
    await s.destroy();
  });

  it('was sich durch Ergänzen nicht reparieren lässt, bleibt gesperrt und unberührt', async () => {
    const p = row();
    await store.protokolle.add(p);
    const broken = jsonToYDoc({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [para('a')] }, para('lose')] }] } as never);
    await store.ydocs.put({ id: p.id, update: Y.encodeStateAsUpdate(broken), dirty: 0, seq: 0 });
    expect(await openProtocol(p.id, deps())).toMatchObject({ kind: 'readonly', reason: 'unreadable' });
    expect(await store.ydocs.get(p.id)).toMatchObject({ seq: 0, dirty: 0 });
  });

  it('ein Schnappschuss, den der Editor nicht bauen würde, bekommt keine Basis', async () => {
    const p = row({ rev: 0, content: doc({ type: 'listItem', content: [para('lose')] }) });
    await store.protokolle.add(p);
    expect(await openProtocol(p.id, deps())).toMatchObject({ kind: 'readonly', reason: 'unreadable' });
    expect(await store.ydocs.count()).toBe(0);
  });

  it('weder gelöscht noch umgestellt: gone / legacy', async () => {
    await store.protokolle.add(row({ id: 'weg-000001', deleted: 1 }));
    await store.protokolle.add(row({ id: 'alt-000001', legacy: true }));
    expect(await openProtocol('weg-000001', deps())).toMatchObject({ reason: 'gone' });
    expect(await openProtocol('nie-000001', deps())).toMatchObject({ reason: 'gone' });
    expect(await openProtocol('alt-000001', deps())).toMatchObject({ reason: 'legacy' });
  });

  it('beim Öffnen wird ein aufgeblähter Zustand verdichtet', async () => {
    const p = row();
    await store.protokolle.add(p);
    const d = new Y.Doc();
    const updates: Uint8Array[] = [];
    d.on('update', (u: Uint8Array) => updates.push(u));
    const frag = d.getXmlFragment('body');
    const para1 = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    para1.insert(0, [text]);
    frag.insert(0, [para1]);
    for (let i = 0; i < 1500; i++) text.insert(text.length, 'x');
    text.delete(0, text.length);
    text.insert(0, 'Rest');
    await store.ydocs.put({ id: p.id, update: Y.mergeUpdates(updates), dirty: 0, seq: 0 });
    const before = (await store.ydocs.get(p.id))!.update.length;
    const s = edit(await openProtocol(p.id, deps()));
    expect((await store.ydocs.get(p.id))!.update.length).toBeLessThan(before / 4);
    expect(textOf(s.doc)).toBe('Rest');
  });
});
