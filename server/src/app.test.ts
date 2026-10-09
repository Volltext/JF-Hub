import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { openDb } from './db.js';
import { buildDocDefinition, renderPdf } from './pdf.js';
import type { ClientChange, SyncResponse } from './sync.js';

const PW = 'ein-sicheres-passwort';
let app: FastifyInstance & { setupCode?: string };

beforeEach(async () => {
  app = await buildApp({ db: openDb(':memory:'), adminPassword: PW, pushTimer: false });
});
afterEach(async () => {
  await app.close();
});

async function login(): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW, device: 'Test' } });
  expect(r.statusCode).toBe(200);
  return r.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}`, 'x-jfh-schema': '2' });

const change = (id: string, over: Partial<ClientChange> = {}): ClientChange => ({
  id,
  baseRev: 0,
  title: 'Sitzung',
  datum: '2026-10-01',
  beginn: '17:30',
  ende: '19:00',
  ort: 'Gerätehaus',
  leitung: 'Anna',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hallo' }] }] },
  updatedAt: Date.now(),
  deleted: false,
  ...over,
});

async function sync(token: string, since: number, changes: ClientChange[]): Promise<SyncResponse> {
  const r = await app.inject({ method: 'POST', url: '/api/sync', headers: auth(token), payload: { since, changes } });
  expect(r.statusCode).toBe(200);
  return r.json() as SyncResponse;
}

describe('Auth', () => {
  it('lehnt Anfragen ohne Anmeldung ab', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/sync', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });

  it('liest JSON auch ohne passenden Content-Type (kein 415)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/login', headers: { 'content-type': 'application/octet-stream' }, payload: JSON.stringify({ username: 'admin', password: PW }) });
    expect(r.statusCode).toBe(200);
  });

  it('lehnt falsches Passwort ab', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'falsch' } });
    expect(r.statusCode).toBe(401);
  });

  it('sperrt nach zu vielen Fehlversuchen', async () => {
    let last = 0;
    for (let i = 0; i < 10; i++) {
      last = (await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'x' } })).statusCode;
    }
    expect(last).toBe(429);
  });

  it('Logout macht den Token ungültig', async () => {
    const t = await login();
    await app.inject({ method: 'POST', url: '/api/logout', headers: auth(t) });
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(t) })).statusCode).toBe(401);
  });

  it('Cookie-Sitzung braucht bei Schreibzugriffen den CSRF-Header', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW } });
    const cookie = r.headers['set-cookie'] as string;
    const c = cookie.split(';')[0]!;
    const bad = await app.inject({ method: 'POST', url: '/api/sync', headers: { cookie: c }, payload: { since: 0, changes: [] } });
    expect(bad.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/api/sync', headers: { cookie: c, 'x-jfh': '1', 'x-jfh-schema': '2' }, payload: { since: 0, changes: [] } });
    expect(ok.statusCode).toBe(200);
  });

  it('Setup-Seite verlangt den Code, wenn kein Passwort gesetzt ist', async () => {
    const fresh = await buildApp({ db: openDb(':memory:'), pushTimer: false });
    expect(fresh.setupCode).toBeTruthy();
    const body = { username: 'leitung', displayName: 'Leitung', password: 'langes-passwort-1' };
    const wrong = await fresh.inject({ method: 'POST', url: '/api/setup', payload: { code: 'nope', ...body } });
    expect(wrong.statusCode).toBe(403);
    const ok = await fresh.inject({ method: 'POST', url: '/api/setup', payload: { code: fresh.setupCode, ...body } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user).toMatchObject({ username: 'leitung', role: 'admin' });
    const again = await fresh.inject({ method: 'POST', url: '/api/setup', payload: { code: 'x', ...body } });
    expect(again.statusCode).toBe(409);
    await fresh.close();
  });

  it('Passwortänderung meldet andere Geräte ab', async () => {
    const a = await login();
    const b = await login();
    const r = await app.inject({ method: 'POST', url: '/api/account/password', headers: auth(a), payload: { current: PW, next: 'neues-passwort-123' } });
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(a) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(b) })).statusCode).toBe(401);
  });
});

describe('Sync', () => {
  it('legt neue Protokolle an und liefert sie ab Revision', async () => {
    const t = await login();
    const r1 = await sync(t, 0, [change('doc-0001')]);
    expect(r1.changes).toHaveLength(1);
    expect(r1.changes[0]!.rev).toBe(1);
    const r2 = await sync(t, r1.rev, []);
    expect(r2.changes).toHaveLength(0);
  });

  it('übernimmt Änderungen auf aktuellem Stand', async () => {
    const t = await login();
    const r1 = await sync(t, 0, [change('doc-0001')]);
    const r2 = await sync(t, r1.rev, [change('doc-0001', { baseRev: r1.changes[0]!.rev, title: 'Neu' })]);
    expect(r2.conflicts).toHaveLength(0);
    expect(r2.changes[0]!.title).toBe('Neu');
  });

  it('sichert veraltete Änderungen als Konfliktkopie', async () => {
    const t = await login();
    const r1 = await sync(t, 0, [change('doc-0001')]);
    const base = r1.changes[0]!.rev;
    await sync(t, r1.rev, [change('doc-0001', { baseRev: base, title: 'Gerät A' })]);
    const r3 = await sync(t, r1.rev, [change('doc-0001', { baseRev: base, title: 'Gerät B' })]);
    expect(r3.conflicts).toHaveLength(1);
    const titles = r3.changes.map((c) => c.title).sort();
    expect(titles).toContain('Gerät A');
    expect(titles).toContain('Gerät B (Konflikt)');
  });

  it('derselbe Stand auf veralteter Basis ist kein Konflikt (z. B. Wiederholung nach verlorener Antwort)', async () => {
    const t = await login();
    const r1 = await sync(t, 0, [change('doc-0001')]);
    const base = r1.changes[0]!.rev;
    const r2 = await sync(t, r1.rev, [change('doc-0001', { baseRev: base, title: 'Neu' })]);
    const r3 = await sync(t, r2.rev, [change('doc-0001', { baseRev: base, title: 'Neu' })]);
    expect(r3.conflicts).toHaveLength(0);
    // Das Original geht zum Aufholen mit zurück, obwohl der Stand des Geräts schon darüber liegt.
    expect(r3.changes.map((c) => c.id)).toEqual(['doc-0001']);
    expect(r3.changes[0]!.rev).toBe(r2.changes[0]!.rev);
    expect((await sync(t, 0, [])).changes).toHaveLength(1);
  });

  it('bei einem Konflikt geht das Original immer mit zurück, auch wenn der Stand des Geräts darüber liegt', async () => {
    const t = await login();
    const r1 = await sync(t, 0, [change('doc-0001')]);
    const base = r1.changes[0]!.rev;
    const r2 = await sync(t, r1.rev, [change('doc-0001', { baseRev: base, title: 'Gerät A' })]);
    const r3 = await sync(t, r2.rev, [change('doc-0001', { baseRev: base, title: 'Gerät B' })]);
    expect(r3.conflicts).toHaveLength(1);
    expect(r3.changes.find((c) => c.id === 'doc-0001')!.title).toBe('Gerät A');
  });

  it('schreibt die Konfliktkopie bei gleicher veralteter Basis fort, statt neue anzulegen', async () => {
    const t = await login();
    const r1 = await sync(t, 0, [change('doc-0001')]);
    const base = r1.changes[0]!.rev;
    await sync(t, r1.rev, [change('doc-0001', { baseRev: base, title: 'Gerät A' })]);
    const first = await sync(t, r1.rev, [change('doc-0001', { baseRev: base, title: 'Gerät B, Stand 1' })]);
    const again = await sync(t, first.rev, [change('doc-0001', { baseRev: base, title: 'Gerät B, Stand 2' })]);
    expect(again.conflicts).toHaveLength(1);
    expect(again.conflicts[0]!.copyId).toBe(first.conflicts[0]!.copyId);
    const all = (await sync(t, 0, [])).changes;
    expect(all.filter((c) => c.title.endsWith('(Konflikt)')).map((c) => c.title)).toEqual(['Gerät B, Stand 2 (Konflikt)']);
  });

  it('legt eine neue Kopie an, wenn die bisherige inzwischen bearbeitet wurde', async () => {
    const t = await login();
    const r1 = await sync(t, 0, [change('doc-0001')]);
    const base = r1.changes[0]!.rev;
    await sync(t, r1.rev, [change('doc-0001', { baseRev: base, title: 'Gerät A' })]);
    const first = await sync(t, r1.rev, [change('doc-0001', { baseRev: base, title: 'Gerät B, Stand 1' })]);
    const copyId = first.conflicts[0]!.copyId;
    const copyRev = first.changes.find((c) => c.id === copyId)!.rev;
    await sync(t, first.rev, [change(copyId, { baseRev: copyRev, title: 'Von Hand weiterbearbeitet' })]);
    const next = await sync(t, 0, [change('doc-0001', { baseRev: base, title: 'Gerät B, Stand 2' })]);
    expect(next.conflicts[0]!.copyId).not.toBe(copyId);
    expect(next.changes.find((c) => c.id === copyId)!.title).toBe('Von Hand weiterbearbeitet'); // die Arbeit an der Kopie bleibt erhalten
  });

  it('Löschen erzeugt Tombstone, Bearbeitung weckt ihn wieder auf', async () => {
    const t = await login();
    const r1 = await sync(t, 0, [change('doc-0001')]);
    const r2 = await sync(t, r1.rev, [change('doc-0001', { baseRev: r1.changes[0]!.rev, deleted: true })]);
    expect(r2.changes[0]!.deleted).toBe(true);
    const r3 = await sync(t, r2.rev, [change('doc-0001', { baseRev: 0, title: 'Zurück' })]);
    expect(r3.changes[0]!.deleted).toBe(false);
    expect(r3.changes[0]!.title).toBe('Zurück');
  });

  it('synchronisiert Ordner und die Zuordnung der Protokolle', async () => {
    const t = await login();
    const folder = { id: 'ordner-0001', name: 'Dienstbesprechungen', parentId: '', updatedAt: 1, deleted: false };
    const r = await app.inject({ method: 'POST', url: '/api/sync', headers: auth(t), payload: { since: 0, folders: [folder], changes: [change('doc-0001', { folderId: 'ordner-0001' })] } });
    const res = r.json() as SyncResponse & { folders: { id: string; name: string }[] };
    expect(res.folders.map((f) => f.name)).toEqual(['Dienstbesprechungen']);
    expect(res.changes[0]!.folderId).toBe('ordner-0001');
    const again = await app.inject({ method: 'POST', url: '/api/sync', headers: auth(t), payload: { since: res.rev, changes: [] } });
    expect((again.json() as { folders: unknown[] }).folders).toHaveLength(0);
    const zip = await app.inject({ method: 'GET', url: '/api/export.zip', headers: auth(t) });
    expect(zip.rawPayload.toString('latin1')).toContain('Dienstbesprechungen/');
  });

  it('gleicht Aufgaben & Co. ab: letzte Änderung gewinnt', async () => {
    const t = await login();
    const rec = (title: string, updatedAt: number, deleted = false) => ({ collection: 'tasks', id: 'task-000001', data: { id: 'task-000001', title }, updatedAt, deleted });
    const post = async (since: number, records: unknown[]) =>
      (await app.inject({ method: 'POST', url: '/api/sync', headers: auth(t), payload: { since, changes: [], records } })).json() as SyncResponse & { records: { data: { title: string }; deleted: boolean }[]; counts: { records: number } };
    const r1 = await post(0, [rec('neu', 100)]);
    expect(r1.records[0]!.data.title).toBe('neu');
    expect(r1.counts.records).toBe(1);
    const r2 = await post(r1.rev, [rec('älter', 50)]); // ältere Änderung wird ignoriert
    expect(r2.records).toHaveLength(0);
    const r3 = await post(r1.rev, [rec('neuer', 200)]);
    expect(r3.records[0]!.data.title).toBe('neuer');
    const r4 = await post(r3.rev, [rec('', 300, true)]);
    expect(r4.records[0]!.deleted).toBe(true);
    // Eine unbekannte Sammlung wird einzeln abgelehnt; der Abgleich selbst gelingt.
    const bad = await app.inject({ method: 'POST', url: '/api/sync', headers: auth(t), payload: { since: 0, changes: [], records: [{ collection: 'users', id: 'abcdef', data: {}, updatedAt: 1, deleted: false }] } });
    expect(bad.statusCode).toBe(200);
    expect(bad.json().rejected).toEqual([{ kind: 'record', id: 'abcdef', collection: 'users', reason: 'ungültiger Datensatz' }]);
  });

  it('nimmt Kleidergrößen an und meldet die erlaubten Sammlungen', async () => {
    const t = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync',
      headers: auth(t),
      payload: {
        since: 0,
        changes: [],
        records: [
          { collection: 'clothing', id: '6b1f0c1e-1d6a-4f7e-9a51-0c1f2e3d4a5b', data: { id: '6b1f0c1e-1d6a-4f7e-9a51-0c1f2e3d4a5b', items: { 'kombi-jacke': { current: '52', request: null } } }, updatedAt: 5, deleted: false },
          { collection: 'clothingItems', id: 'kombi-jacke', data: { id: 'kombi-jacke', name: 'Kombi-Jacke', sizes: ['50', '52'], order: 0 }, updatedAt: 1, deleted: false },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncResponse;
    expect(body.collections).toEqual(expect.arrayContaining(['tasks', 'clothing', 'clothingItems']));
    expect(body.records.map((r) => r.collection).sort()).toEqual(['clothing', 'clothingItems']);
  });

  it('gleicht Wettkampf-Läufe und Aufstellungsvorlagen für die ganze Gruppe ab', async () => {
    const t = await login();
    const inv = await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(t), payload: { username: 'anna', displayName: 'Anna' } });
    const acc = await app.inject({ method: 'POST', url: '/api/invite/accept', payload: { username: 'anna', code: inv.json().invite.code, password: 'anna-passwort-123' } });
    const anna = acc.json().token as string;
    const post = async (token: string, since: number, records: unknown[]) =>
      (await app.inject({ method: 'POST', url: '/api/sync', headers: auth(token), payload: { since, changes: [], records } })).json() as SyncResponse & { records: { collection: string; id: string; data: { notes?: string }; deleted: boolean }[] };

    const run = { id: 'run-0001', mode: 'a', totalMs: 90_000, notes: 'gut' };
    const up = await post(t, 0, [
      { collection: 'runs', id: 'run-0001', data: run, updatedAt: 5, deleted: false },
      { collection: 'lineupTemplates', id: 'tpl-0001', data: { id: 'tpl-0001', name: 'Standard', assignments: {} }, updatedAt: 5, deleted: false },
    ]);
    expect(up.collections).toEqual(expect.arrayContaining(['runs', 'lineupTemplates']));

    // Anna sieht beides, ändert die Notiz, und der Admin bekommt die Änderung.
    const seen = await post(anna, 0, []);
    expect(seen.records.map((r) => r.collection).sort()).toEqual(['lineupTemplates', 'runs']);
    const edit = await post(anna, seen.rev, [{ collection: 'runs', id: 'run-0001', data: { ...run, notes: 'sehr gut' }, updatedAt: 9, deleted: false }]);
    const back = await post(t, up.rev, []);
    expect(back.records.find((r) => r.id === 'run-0001')!.data.notes).toBe('sehr gut');

    // Löschen kann jeder Betreuer (Gruppendaten wie Mitglieder).
    await post(anna, edit.rev, [{ collection: 'runs', id: 'run-0001', data: {}, updatedAt: 12, deleted: true }]);
    expect((await post(t, back.rev, [])).records.find((r) => r.id === 'run-0001')!.deleted).toBe(true);
  });

  it('erkennt einen nicht passenden Stand (neue Datenbank) und liefert alles neu', async () => {
    const t = await login();
    await sync(t, 0, [change('doc-0001')]);
    const post = async (body: object) => (await app.inject({ method: 'POST', url: '/api/sync', headers: auth(t), payload: body })).json() as SyncResponse;
    // Client ohne Kennung, aber mit Stand weit über dem Server
    const a = await post({ since: 99, changes: [] });
    expect(a.reset).toBe(true);
    expect(a.changes).toHaveLength(1);
    // Client mit falscher Kennung
    const b = await post({ since: 1, epoch: 'andere-db', changes: [] });
    expect(b.reset).toBe(true);
    // Passende Kennung: normaler Abgleich
    const c = await post({ since: a.rev, epoch: a.epoch, changes: [] });
    expect(c.reset).toBe(false);
    expect(c.changes).toHaveLength(0);
  });

  it('lehnt ungültige IDs einzeln ab, ohne den Abgleich zu sperren', async () => {
    const t = await login();
    const r = await app.inject({ method: 'POST', url: '/api/sync', headers: auth(t), payload: { since: 0, changes: [change('../x'), change('gut-0001')] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().rejected).toEqual([{ kind: 'protocol', id: '../x', reason: 'ungültige ID' }]);
    expect((r.json() as SyncResponse).changes.map((c) => c.id)).toEqual(['gut-0001']); // das gültige Protokoll wurde gespeichert
  });

  it('ein unbrauchbares oder zu großes Protokoll sperrt den Abgleich nicht: nur es wird abgelehnt', async () => {
    const t = await login();
    const huge = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(12_100_000) }] }] };
    const r = await app.inject({
      method: 'POST',
      url: '/api/sync',
      headers: auth(t),
      payload: {
        since: 0,
        changes: [
          change('gross-0001', { content: huge }),
          change('liste-001', { content: { type: 'doc', content: [{ type: 'bulletList', content: 5 }] } }),
          change('wurzel-01', { content: { type: 'paragraph' } }),
          change('tief-0001', { content: nest(150) }),
          change('gut-0001'),
        ],
        folders: [{ id: '../kaputt', name: 'x', parentId: '', updatedAt: 1, deleted: false }, { id: 'ordner-0001', name: 'Gut', parentId: '', updatedAt: 1, deleted: false }],
      },
    });
    expect(r.statusCode).toBe(200);
    const res = r.json() as SyncResponse & { rejected: { kind: string; id: string; reason: string }[]; folders: { id: string }[] };
    expect(res.changes.map((c) => c.id)).toEqual(['gut-0001']);
    expect(res.folders.map((f) => f.id)).toEqual(['ordner-0001']);
    expect(Object.fromEntries(res.rejected.map((x) => [x.id, x.reason]))).toEqual({
      'gross-0001': 'Protokoll zu groß',
      'liste-001': 'Inhalt enthält einen Knoten, dessen Inhalt keine Liste ist',
      'wurzel-01': 'Inhalt ist kein Dokument',
      'tief-0001': 'Inhalt ist zu tief verschachtelt',
      '../kaputt': 'ungültige Ordner-ID',
    });
    // Abgelehntes hinterlässt nichts: Revisionen laufen weiter, und ein zweiter Abgleich liefert nur das Gespeicherte.
    expect((await sync(t, 0, [])).changes.map((c) => c.id)).toEqual(['gut-0001']);
  });

  it('Löschen gewinnt auch gegen eine Bearbeitung auf veraltetem Stand (der Papierkorb macht es umkehrbar)', async () => {
    const t = await login();
    const r1 = await sync(t, 0, [change('doc-0001')]);
    const base = r1.changes[0]!.rev;
    await sync(t, r1.rev, [change('doc-0001', { baseRev: base, title: 'Von einem anderen Gerät bearbeitet' })]);
    const r3 = await sync(t, r1.rev, [change('doc-0001', { baseRev: base, deleted: true })]);
    expect(r3.changes.find((c) => c.id === 'doc-0001')!.deleted).toBe(true);
    // Die Bearbeitung ist nicht verloren, sondern liegt im Papierkorb.
    expect((await app.inject({ method: 'POST', url: '/api/admin/protocols/doc-0001/restore', headers: auth(t) })).statusCode).toBe(200);
    expect((await sync(t, 0, [])).changes.find((c) => c.id === 'doc-0001')).toMatchObject({ deleted: false, title: 'Von einem anderen Gerät bearbeitet' });
  });
});

/** Verschachtelt Absätze `n` Ebenen tief (für den Test der Tiefenbegrenzung). */
function nest(n: number): unknown {
  let node: unknown = { type: 'paragraph' };
  for (let i = 0; i < n; i++) node = { type: 'blockquote', content: [node] };
  return { type: 'doc', content: [node] };
}

describe('PDF und Admin', () => {
  it('erzeugt ein gültiges PDF', async () => {
    const t = await login();
    await sync(t, 0, [change('doc-0001')]);
    const r = await app.inject({ method: 'GET', url: '/api/protocols/doc-0001/pdf', headers: auth(t) });
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('Vorschau-PDF und Export funktionieren', async () => {
    const t = await login();
    await sync(t, 0, [change('doc-0001')]);
    const p = await app.inject({ method: 'GET', url: '/api/admin/preview.pdf', headers: auth(t) });
    expect(p.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const z = await app.inject({ method: 'GET', url: '/api/export.zip', headers: auth(t) });
    expect(z.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });

  it('Papierkorb: wiederherstellen und endgültig löschen', async () => {
    const t = await login();
    const r1 = await sync(t, 0, [change('doc-0001')]);
    await sync(t, r1.rev, [change('doc-0001', { baseRev: r1.changes[0]!.rev, deleted: true })]);
    expect((await app.inject({ method: 'POST', url: '/api/admin/protocols/doc-0001/restore', headers: auth(t) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/protocols/doc-0001', headers: auth(t) })).statusCode).toBe(404);
  });

  it('validiert Einstellungen', async () => {
    const t = await login();
    const bad = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: auth(t), payload: { accent: 'rot' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: auth(t), payload: { accent: '#112233', orgName: 'JF Test' } });
    expect(ok.json().orgName).toBe('JF Test');
  });

  it('Handschrift kommt als SVG ins PDF (Zeichenfläche und ganze Seite)', async () => {
    const wave = Array.from({ length: 40 }, (_, i) => [20 + i * 18, 60 + Math.sin(i / 3) * 25, 0.3 + (i % 10) / 14]).flat();
    const ink = (h: number, bg: string) => ({ v: 1, w: 800, h, bg, s: [{ t: 'h', c: '#fdd835', w: 24, p: [10, 60, 1, 700, 60, 1] }, { t: 'p', c: '#1565c0', w: 2.6, p: wave }] });
    const doc = {
      id: 'x', title: 'Skizze', datum: '2026-10-01', beginn: '', ende: '', ort: '', leitung: '', rev: 1, updatedAt: 0, deleted: false,
      content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Davor' }] },
        { type: 'ink', attrs: { variant: 'block', ink: ink(200, 'none') } },
        { type: 'ink', attrs: { variant: 'page', ink: ink(1131, 'lined') } },
        { type: 'ink', attrs: { variant: 'block', ink: 'kaputt' } },
      ] },
    };
    const st = { orgName: 'JF', footer: '', accent: '#c0392b', logo: '' };
    const def = buildDocDefinition(doc, st);
    const nodes = (def.content as { svg?: string; pageBreak?: string }[]).filter((n) => n.svg);
    expect(nodes).toHaveLength(2);
    expect(nodes[1]!.pageBreak).toBe('before');
    const pdf = await renderPdf(doc, st);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    if (process.env.INK_PDF_OUT) (await import('node:fs')).writeFileSync(process.env.INK_PDF_OUT, pdf);
  });

  it('Fotos kommen ins PDF, Dateianhänge werden aufgeführt', async () => {
    const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wgARCAAwAEADAREAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAcI/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAcI/9oADAMBAAIQAxAAAAGU6CmIAAAAAAAAAAA3Nn2nAAAAAAAAAAAD/8QAFBABAAAAAAAAAAAAAAAAAAAAUP/aAAgBAQABBQJD/8QAFBEBAAAAAAAAAAAAAAAAAAAAUP/aAAgBAwEBPwFD/8QAFBEBAAAAAAAAAAAAAAAAAAAAUP/aAAgBAgEBPwFD/8QAFBABAAAAAAAAAAAAAAAAAAAAUP/aAAgBAQAGPwJD/8QAFBABAAAAAAAAAAAAAAAAAAAAUP/aAAgBAQABPyFD/9oADAMBAAIAAwAAABAAAAAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAABQ/9oACAEDAQE/EEP/xAAUEQEAAAAAAAAAAAAAAAAAAABQ/9oACAECAQE/EEP/xAAUEAEAAAAAAAAAAAAAAAAAAABQ/9oACAEBAAE/EEP/2Q==';
    const doc = {
      id: 'x', title: 'Fotos', datum: '2026-10-01', beginn: '', ende: '', ort: '', leitung: '', rev: 1, updatedAt: 0, deleted: false,
      content: { type: 'doc', content: [
        { type: 'photo', attrs: { src: jpg, w: 64, h: 48, caption: 'Übung am Teich' } },
        { type: 'photo', attrs: { src: 'data:text/html;base64,AAAA', w: 1, h: 1, caption: '' } },
        { type: 'attachment', attrs: { name: 'Plan.pdf', mime: 'application/pdf', size: 204800, data: 'AAAA' } },
      ] },
    };
    const st = { orgName: 'JF', footer: '', accent: '#c0392b', logo: '' };
    const def = buildDocDefinition(doc, st);
    const text = JSON.stringify(def.content);
    expect(text).toContain('Übung am Teich');
    expect(text).toContain('Plan.pdf');
    expect((def.content as { image?: string }[]).filter((c) => c.image)).toHaveLength(1);
    const pdf = await renderPdf(doc, st);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    if (process.env.PHOTO_PDF_OUT) (await import('node:fs')).writeFileSync(process.env.PHOTO_PDF_OUT, pdf);
  });

  it('Dokumentdefinition enthält Kopfdaten und Inhalt', () => {
    const def = buildDocDefinition(
      { id: 'x', title: 'T', datum: '2026-10-01', beginn: '17:00', ende: '', ort: 'Ort', leitung: '', content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H' }] }] }, rev: 1, updatedAt: 0, deleted: false },
      { orgName: 'JF', footer: '', accent: '#c0392b', logo: '' },
    );
    expect(JSON.stringify(def.content)).toContain('Donnerstag, 01.10.2026');
    expect(JSON.stringify(def.content)).toContain('"text":"H"');
  });
});
