import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HubDb } from '@/core/db/db';
import { newProtokoll } from '../model';
import { FIELD } from './yJson';
import { applyAnswer, compact, discard, dirtyYCount, forgetServerState, getYRow, isEmptyUpdate, loadDoc, markRejected, putBase, putLocal } from './yStore';

let store: HubDb;
let n = 0;
beforeEach(() => {
  store = new HubDb(`test-ystore-${++n}`);
});
afterEach(async () => {
  await store.delete();
});

/** Ein Gerät: ein Dokument, dessen Änderungen als Updates herauskommen. */
function device(): { doc: Y.Doc; type: (text: string) => Uint8Array; text: () => string } {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment(FIELD);
  let last: Uint8Array = new Uint8Array();
  doc.on('update', (u: Uint8Array) => (last = u));
  return {
    doc,
    type: (text) => {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, text);
      p.insert(0, [t]);
      frag.insert(frag.length, [p]);
      return last;
    },
    text: () => frag.toString(),
  };
}

const addRow = (id: string) => store.protokolle.add({ ...newProtokoll(), id });
const textRevOf = async (id: string) => (await store.protokolle.get(id))?.textRev;

const stateOf = (u: Uint8Array): Y.Doc => {
  const d = new Y.Doc();
  Y.applyUpdate(d, u);
  return d;
};

describe('putLocal', () => {
  it('legt die Zeile an, merkt sie vor und zählt mit', async () => {
    const a = device();
    expect(await putLocal('p-000001', a.type('eins'), store)).toBe(1);
    expect(await getYRow('p-000001', store)).toMatchObject({ dirty: 1, seq: 1 });
    expect(await putLocal('p-000001', a.type('zwei'), store)).toBe(2);
    const row = (await getYRow('p-000001', store))!;
    expect(stateOf(row.update).getXmlFragment(FIELD).toString()).toBe(a.text());
  });

  it('zwei gleichzeitige Zugriffe (zwei Tabs) nehmen einander nichts', async () => {
    const a = device();
    const b = device();
    const ua = a.type('von A');
    const ub = b.type('von B');
    await Promise.all([putLocal('p-000001', ua, store), putLocal('p-000001', ub, store)]);
    const row = (await getYRow('p-000001', store))!;
    expect(row.seq).toBe(2);
    const text = stateOf(row.update).getXmlFragment(FIELD).toString();
    expect(text).toContain('von A');
    expect(text).toContain('von B');
  });

  it('mit „nur wenn es die Zeile gibt“ entsteht keine Teilzeile aus der letzten Änderung (Zustand wurde verworfen)', async () => {
    const a = device();
    expect(await putLocal('p-000001', a.type('eins'), store, true)).toBeUndefined();
    expect(await getYRow('p-000001', store)).toBeUndefined();
    await putLocal('p-000001', a.type('zwei'), store);
    expect(await putLocal('p-000001', a.type('drei'), store, true)).toBe(2); // gibt es die Zeile, schreibt es wie sonst
  });

  it('eine neue Änderung hebt eine frühere Ablehnung auf', async () => {
    const a = device();
    await putLocal('p-000001', a.type('x'), store);
    await markRejected('p-000001', 'Protokoll zu groß', 1, store);
    expect((await getYRow('p-000001', store))!.rejected).toBe('Protokoll zu groß');
    await putLocal('p-000001', a.type('y'), store);
    expect((await getYRow('p-000001', store))!.rejected).toBeUndefined();
  });
});

describe('applyAnswer', () => {
  it('mischt die Antwort, merkt den Stand des Servers und räumt auf, wenn seitdem nichts dazukam', async () => {
    await addRow('p-000001');
    const a = device();
    const seq = await putLocal('p-000001', a.type('lokal'), store);
    const server = device();
    const remote = server.type('vom Server');
    const sv = Y.encodeStateVector(a.doc);
    const row = await applyAnswer('p-000001', { update: remote, sv, rev: 7 }, seq, store);
    expect(row).toMatchObject({ dirty: 0, seq });
    expect(await textRevOf('p-000001')).toBe(7); // bis zu dieser Revision kennt das Gerät den Text
    expect(Buffer.from(row.serverSv!).equals(Buffer.from(sv))).toBe(true);
    const text = stateOf(row.update).getXmlFragment(FIELD).toString();
    expect(text).toContain('lokal');
    expect(text).toContain('vom Server');
  });

  it('wurde während der Übertragung weitergeschrieben, bleibt die Zeile vorgemerkt', async () => {
    const a = device();
    const sent = await putLocal('p-000001', a.type('eins'), store);
    await putLocal('p-000001', a.type('zwei'), store); // während der Anfrage
    const row = await applyAnswer('p-000001', { sv: Y.encodeStateVector(a.doc), rev: 3 }, sent, store);
    expect(row.dirty).toBe(1);
  });

  it('ohne neue Angaben bleiben Zustandsvektor und Revision stehen (Kurzschluss des Servers)', async () => {
    await addRow('p-000001');
    const a = device();
    const seq = await putLocal('p-000001', a.type('x'), store);
    const sv = Y.encodeStateVector(a.doc);
    await applyAnswer('p-000001', { sv, rev: 5 }, seq, store);
    const row = await applyAnswer('p-000001', { rev: 5 }, seq, store);
    expect(await textRevOf('p-000001')).toBe(5);
    expect(Buffer.from(row.serverSv!).equals(Buffer.from(sv))).toBe(true);
  });

  it('gibt es noch keine Zeile (Vorabladen), entsteht eine saubere; ein leerer Text ist ein bekannter leerer Text', async () => {
    await addRow('p-000002');
    await addRow('p-000003');
    const server = device();
    const row = await applyAnswer('p-000002', { update: server.type('Text'), sv: Y.encodeStateVector(server.doc), rev: 2 }, 0, store);
    expect(row).toMatchObject({ dirty: 0, seq: 0 });
    expect(await textRevOf('p-000002')).toBe(2);
    expect(stateOf(row.update).getXmlFragment(FIELD).toString()).toContain('Text');

    const empty = await applyAnswer('p-000003', { rev: 4 }, 0, store);
    expect(isEmptyUpdate(empty.update)).toBe(true);
    expect(empty).toMatchObject({ dirty: 0 });
    expect(await textRevOf('p-000003')).toBe(4);
  });

  it('die bestätigte Basis ist keine „neue“ mehr, eine frühere Ablehnung entfällt', async () => {
    const a = device();
    await putBase('p-000001', Y.encodeStateAsUpdate(stateOf(a.type('Altbestand'))), store);
    expect((await getYRow('p-000001', store))!.created).toBe(true);
    await markRejected('p-000001', 'x', 1, store);
    const row = await applyAnswer('p-000001', { sv: Y.encodeStateVector(a.doc), rev: 1 }, 1, store);
    expect(row.created).toBeUndefined();
    expect(row.rejected).toBeUndefined();
    expect(row.dirty).toBe(0);
  });
});

describe('applyAnswer: was die Antwort bestätigt', () => {
  it('war der eigene Text nicht Teil der Anfrage (sentSeq undefined), bleiben Vormerkung, Ablehnung und Basis stehen, auch wenn Neues vom Server kommt', async () => {
    await addRow('p-000001');
    const a = device();
    await putBase('p-000001', Y.encodeStateAsUpdate(stateOf(a.type('Altbestand'))), store);
    await markRejected('p-000001', 'Protokoll zu groß', 1, store);
    const server = device();
    const row = await applyAnswer('p-000001', { update: server.type('vom Server'), sv: Y.encodeStateVector(server.doc), rev: 4 }, undefined, store);
    expect(row).toMatchObject({ dirty: 1, rejected: 'Protokoll zu groß', created: true });
    expect(stateOf(row.update).getXmlFragment(FIELD).toString()).toContain('vom Server'); // das Neue ist trotzdem gemischt
    expect(await dirtyYCount(store)).toBe(1); // der Text gilt weiter als ungesendet
  });

  it('für ein Protokoll, das es nicht mehr gibt (abgemeldet), legt eine späte Antwort keine Zeile an', async () => {
    const server = device();
    const row = await applyAnswer('weg-000001', { update: server.type('fremder Text'), sv: Y.encodeStateVector(server.doc), rev: 3 }, undefined, store);
    expect(row).toMatchObject({ id: 'weg-000001', dirty: 0 });
    expect(await store.ydocs.get('weg-000001')).toBeUndefined();
    expect(await store.protokolle.get('weg-000001')).toBeUndefined();
  });
});

describe('putBase', () => {
  it('legt die Basis nur an, wenn es noch nichts gibt', async () => {
    const a = device();
    const first = await putBase('p-000001', a.type('erste'), store);
    expect(first).toMatchObject({ dirty: 1, created: true, seq: 1 });
    const b = device();
    const second = await putBase('p-000001', b.type('zweite'), store);
    expect(second.update).toEqual(first.update); // der erste bleibt, sonst würde der Inhalt doppelt
  });
});

describe('markRejected, forgetServerState, discard', () => {
  it('die Ablehnung gilt nur für die gesendete Fassung', async () => {
    const a = device();
    await putLocal('p-000001', a.type('x'), store);
    await markRejected('p-000001', 'zu groß', 0, store);
    expect((await getYRow('p-000001', store))!.rejected).toBeUndefined();
    await markRejected('p-000001', 'zu groß', 1, store);
    expect((await getYRow('p-000001', store))!.rejected).toBe('zu groß');
  });

  it('der Server kennt unseren Stand nicht mehr: beim nächsten Mal geht alles hoch', async () => {
    await addRow('p-000001');
    const a = device();
    const seq = await putLocal('p-000001', a.type('x'), store);
    await applyAnswer('p-000001', { sv: Y.encodeStateVector(a.doc), rev: 2 }, seq, store);
    await forgetServerState('p-000001', store);
    expect(await getYRow('p-000001', store)).toMatchObject({ serverSv: undefined, dirty: 0 });
    expect(await textRevOf('p-000001')).toBeUndefined();
  });

  it('verwerfen und zählen', async () => {
    const a = device();
    await putLocal('p-000001', a.type('x'), store);
    await putLocal('p-000002', a.type('y'), store);
    expect(await dirtyYCount(store)).toBe(2);
    await discard('p-000001', store);
    expect(await getYRow('p-000001', store)).toBeUndefined();
    expect(await dirtyYCount(store)).toBe(1);
  });
});

describe('compact', () => {
  it('verdichtet einen Zustand mit viel gelöschtem Text, ohne Zählung und Vormerkung anzufassen', async () => {
    const doc = new Y.Doc();
    const text = doc.getText('t');
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    for (let i = 0; i < 1500; i++) text.insert(text.length, 'x');
    text.delete(0, text.length);
    text.insert(0, 'Rest');
    for (const u of updates) await putLocal('p-000001', u, store);
    const before = (await getYRow('p-000001', store))!;
    expect(before.update.length).toBeGreaterThan(1500);

    expect(await compact('p-000001', store)).toBe(true);
    const after = (await getYRow('p-000001', store))!;
    expect(after.update.length).toBeLessThan(200);
    expect(after).toMatchObject({ seq: before.seq, dirty: 1 });
    expect(stateOf(after.update).getText('t').toString()).toBe('Rest');
  });

  it('kleine oder schon dichte Zustände bleiben unberührt', async () => {
    const a = device();
    await putLocal('p-000001', a.type('klein'), store);
    expect(await compact('p-000001', store)).toBe(false);
    expect(await compact('gibt-es-nicht', store)).toBe(false);
  });
});

describe('loadDoc', () => {
  it('baut das Dokument aus dem lokalen Zustand', async () => {
    const a = device();
    await putLocal('p-000001', a.type('Hallo'), store);
    const { doc, row } = (await loadDoc('p-000001', store))!;
    expect(doc.getXmlFragment(FIELD).toString()).toContain('Hallo');
    expect(row.id).toBe('p-000001');
    expect(await loadDoc('fehlt-0001', store)).toBeUndefined();
  });
});
