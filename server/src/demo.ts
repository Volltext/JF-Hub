import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.js';
import { currentRev, getConfig, nextRev, setConfig, type Role } from './db.js';

/**
 * Demo-Modus für eine öffentliche Probier-Instanz (`DEMO=1`): feste Zugänge, erfundene Beispieldaten der
 * „Jugendfeuerwehr Musterstadt“ und ein tägliches Zurücksetzen. Was Besucher eintragen, ist danach wieder weg.
 *
 * Beim Zurücksetzen bekommen die Konten neue IDs und alle Sitzungen enden. Geräte landen dadurch auf der Anmeldung
 * und räumen beim nächsten Anmelden ihre lokale Kopie ab (Kontowechsel) – sonst würden sie ihre alten Daten
 * nach dem Epochenwechsel wieder hochladen.
 */

export interface DemoAccount {
  username: string;
  password: string;
  displayName: string;
  role: Role;
  /** Kurzbeschreibung für die Anmeldeseite. */
  hint: string;
}

export const DEMO_PASSWORD = 'jfhub-demo';

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { username: 'jugendwart', password: DEMO_PASSWORD, displayName: 'Jana Becker', role: 'admin', hint: 'Jugendwartin, darf auch die Server-Verwaltung' },
  { username: 'betreuer', password: DEMO_PASSWORD, displayName: 'Tobias Wagner', role: 'betreuer', hint: 'Betreuer' },
];

export const isDemoAccount = (username: unknown): boolean =>
  typeof username === 'string' && DEMO_ACCOUNTS.some((a) => a.username === username.trim().toLowerCase());

// ---------- Zeitplan ----------

export interface ResetTime {
  hour: number;
  minute: number;
}

export const DEFAULT_RESET_AT = '03:00';

/** Liest `DEMO_RESET_AT` (Uhrzeit `HH:MM` in der Zeitzone des Servers). Leer = 03:00. */
export function parseResetAt(v: string | undefined): ResetTime {
  const text = (v ?? '').trim() || DEFAULT_RESET_AT;
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`DEMO_RESET_AT: Uhrzeit als HH:MM angeben (z. B. 03:00), nicht „${text}“`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export const formatResetAt = (t: ResetTime): string => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;

/** Millisekunden bis zum nächsten Zurücksetzen (heute, falls die Uhrzeit noch kommt, sonst morgen). */
export function msUntilReset(now: Date, at: ResetTime): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), at.hour, at.minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

// ---------- Schutz der gemeinsamen Zugänge ----------

export const DEMO_LOCKED = 'In der Demo ausgeschaltet.';

/** Was alle Besucher aussperren oder an fremde Daten kommen würde (Backups enthalten z. B. die Push-Schlüssel). */
const LOCKED = new Set([
  'POST /api/account/password',
  'POST /api/account/sessions/revoke-others',
  'DELETE /api/account/sessions/:id',
  'DELETE /api/admin/sessions/:id',
  'GET /api/admin/backup',
  'POST /api/admin/backups',
  'GET /api/admin/backups/:name',
  'DELETE /api/admin/backups/:name',
  'POST /api/admin/backups/:name/restore',
  'POST /api/admin/restore',
]);

/** Gesperrt, wenn sie eines der Demo-Konten betreffen; selbst angelegte Benutzer dürfen Besucher ändern und löschen. */
const LOCKED_FOR_DEMO_ACCOUNTS = new Set(['PATCH /api/admin/users/:id', 'DELETE /api/admin/users/:id', 'POST /api/admin/users/:id/invite']);

/** Fehlermeldung, wenn die Anfrage im Demo-Modus nicht erlaubt ist, sonst null. `route` ist das Muster der Route. */
export function demoBlock(db: DatabaseSync, method: string, route: string | undefined, params: unknown): string | null {
  if (!route) return null;
  // HEAD führt die GET-Route aus (nur ohne Antworttext) und ist deshalb genauso gesperrt.
  const key = `${method === 'HEAD' ? 'GET' : method} ${route}`;
  if (LOCKED.has(key)) return DEMO_LOCKED;
  if (LOCKED_FOR_DEMO_ACCOUNTS.has(key)) {
    const id = (params as { id?: unknown } | null)?.id;
    const row = db.prepare('SELECT username FROM users WHERE id = ?').get(String(id ?? '')) as { username: string } | undefined;
    if (row && isDemoAccount(row.username)) return `${DEMO_LOCKED} Die Demo-Zugänge bleiben für alle gleich.`;
  }
  return null;
}

// ---------- Zurücksetzen ----------

/** Zur Laufzeit erzeugte Server-Werte, die ein Zurücksetzen überdauern (bestehende Push-Abos der Browser bleiben gültig). */
const KEEP_CONFIG = ['vapidPublic', 'vapidPrivate'];

/**
 * Leert die Datenbank und legt die Beispieldaten neu an. Die Daten sind relativ zu `now` datiert,
 * damit die Demo immer aktuell aussieht (letzter Dienst am vergangenen Montag, Aufgaben in den nächsten Tagen fällig).
 */
export async function resetDemo(db: DatabaseSync, now = new Date()): Promise<void> {
  // Passwörter vorher berechnen: während der Transaktion darf nichts anderes auf der Verbindung laufen.
  const hashes = await Promise.all(DEMO_ACCOUNTS.map((a) => hashPassword(a.password)));
  const keep = Object.fromEntries(KEEP_CONFIG.map((k) => [k, getConfig(db, k)]));
  const liveRev = currentRev(db);

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const t of ['push_reminders', 'push_subscriptions', 'sessions', 'protocols', 'folders', 'records', 'users', 'config']) db.exec(`DELETE FROM ${t}`);
    for (const [k, v] of Object.entries(keep)) if (v !== undefined) setConfig(db, k, v);
    // Revisionen nie zurückdrehen; neue Epoche, damit Geräte ihren Stand verwerfen.
    setConfig(db, 'revCounter', String(liveRev));
    setConfig(db, 'epoch', randomUUID());
    setConfig(db, 'orgName', 'Jugendfeuerwehr Musterstadt');
    setConfig(db, 'footer', 'JF Hub Demo · alle Namen sind erfunden');
    seed(db, now, hashes);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  // Platz von großen Anhängen der Besucher freigeben; klappt das nicht (z. B. Platte voll), gilt das Zurücksetzen trotzdem.
  try {
    db.exec('VACUUM');
  } catch {
    /* beim nächsten Zurücksetzen erneut */
  }
}

// ---------- Beispieldaten ----------

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (d: Date, hour: number, minute = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());

/** Vorhersagbarer Zufall (mulberry32), damit jede Demo gleich aussieht. */
function random(seedValue: number): () => number {
  let a = seedValue;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoMember {
  id: string;
  name: string;
  kind: 'jugendlich' | 'betreuer';
  active: boolean;
  /** Wahrscheinlichkeit, beim Dienst da zu sein. */
  attendance: number;
  /** Stelle in der Größenreihe (0 = 128). */
  size: number;
}

const MEMBERS: DemoMember[] = [
  ['Emma Schulz', 0.95, 4],
  ['Leon Hoffmann', 0.9, 7],
  ['Mia Koch', 0.85, 3],
  ['Paul Richter', 0.9, 8],
  ['Hannah Klein', 0.8, 2],
  ['Ben Wolf', 0.7, 6],
  ['Lina Neumann', 0.95, 5],
  ['Finn Schwarz', 0.85, 9],
  ['Sophie Zimmermann', 0.6, 1],
  ['Jonas Krüger', 0.9, 10],
  ['Marie Hartmann', 0.85, 4],
  ['Luca Lange', 0.75, 0],
  ['Emily Werner', 0.9, 6],
  ['Noah Schmitt', 0.8, 3],
]
  .map(([name, attendance, size], i): DemoMember => ({ id: `demo-m-${pad(i + 1)}`, name: name as string, kind: 'jugendlich', active: true, attendance: attendance as number, size: size as number }))
  .concat([
    { id: 'demo-m-15', name: 'Tim Krause', kind: 'jugendlich', active: false, attendance: 0, size: 11 },
    { id: 'demo-m-20', name: 'Jana Becker', kind: 'betreuer', active: true, attendance: 0.95, size: -1 },
    { id: 'demo-m-21', name: 'Tobias Wagner', kind: 'betreuer', active: true, attendance: 0.85, size: -1 },
    { id: 'demo-m-22', name: 'Lena Schröder', kind: 'betreuer', active: true, attendance: 0.7, size: -1 },
  ]);

const KIDS = ['128', '134', '140', '146', '152', '158', '164', '170', '176'];
const MEN = ['44', '46', '48', '50', '52', '54', '56', '58', '60', '62', '64'];
const LETTERS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
const GLOVES = ['4', '5', '6', '7', '8', '9', '10', '11', '12'];

/** Wie `DEFAULT_ITEMS` der App (gleiche IDs), damit die Geräte keine zweite Liste anlegen. */
const CLOTHING_ITEMS = [
  { id: 'kombi-jacke', name: 'Kombi-Jacke', sizes: [...KIDS, ...MEN], order: 0 },
  { id: 'kombi-hose', name: 'Kombi-Hose', sizes: [...KIDS, ...MEN], order: 1 },
  { id: 'regenjacke', name: 'Regenjacke', sizes: [...KIDS, ...LETTERS], order: 2 },
  { id: 'handschuhe', name: 'Handschuhe', sizes: GLOVES, order: 3 },
];

type Node = Record<string, unknown>;
const text = (t: string, marks?: string[]): Node => ({ type: 'text', text: t, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) });
const p = (...parts: (string | Node)[]): Node => ({ type: 'paragraph', content: parts.map((x) => (typeof x === 'string' ? text(x) : x)) });
const h2 = (t: string): Node => ({ type: 'heading', attrs: { level: 2 }, content: [text(t)] });
const ul = (...items: string[]): Node => ({ type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [p(t)] })) });
const ol = (...items: string[]): Node => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map((t) => ({ type: 'listItem', content: [p(t)] })) });
const todo = (...items: [string, boolean][]): Node => ({ type: 'taskList', content: items.map(([t, checked]) => ({ type: 'taskItem', attrs: { checked }, content: [p(t)] })) });
const quote = (t: string): Node => ({ type: 'blockquote', content: [p(t)] });
const doc = (...content: Node[]) => JSON.stringify({ type: 'doc', content });

function seed(db: DatabaseSync, now: Date, hashes: string[]): void {
  const t0 = now.getTime();
  const rnd = random(20261006);

  // --- Konten (neue IDs bei jedem Zurücksetzen) ---
  const ids: Record<string, string> = {};
  const insertUser = db.prepare(
    'INSERT INTO users(id, username, displayName, role, passwordHash, inviteHash, inviteExpiresAt, disabled, createdAt, lastLoginAt) VALUES(?,?,?,?,?,?,?,0,?,NULL)',
  );
  DEMO_ACCOUNTS.forEach((a, i) => {
    ids[a.username] = randomUUID().replace(/-/g, '');
    insertUser.run(ids[a.username]!, a.username, a.displayName, a.role, hashes[i]!, null, null, t0 - 120 * DAY);
  });
  // Eine offene Einladung, damit die Benutzerverwaltung zeigt, wie das aussieht. Den Code kennt niemand.
  insertUser.run(randomUUID().replace(/-/g, ''), 'lena', 'Lena Schröder', 'betreuer', null, createHash('sha256').update(randomBytes(16)).digest('hex'), t0 + 5 * DAY, t0 - 2 * DAY);
  const jana = ids.jugendwart!;
  const tobias = ids.betreuer!;

  const putRecord = db.prepare('INSERT INTO records(collection, id, data, ownerId, shared, hiddenRev, rev, updatedAt, deletedAt) VALUES(?,?,?,?,?,NULL,?,?,NULL)');
  const record = (collection: string, id: string, data: unknown, ownerId = jana, shared = 1, updatedAt = t0) =>
    putRecord.run(collection, id, JSON.stringify(data), ownerId, shared, nextRev(db), Math.min(updatedAt, t0));

  // --- Mitglieder ---
  for (const m of MEMBERS) record('members', m.id, { id: m.id, name: m.name, kind: m.kind, active: m.active }, jana, 1, t0 - 90 * DAY);

  // --- Dienste: montags (wie die Dienst-Erinnerung der App ab Werk), die letzten 12 Wochen, mit zwei Wochen Herbstferien ---
  const active = MEMBERS.filter((m) => m.active);
  const lastMonday = addDays(now, -(((now.getDay() + 6) % 7) || 7));
  const dienste: { id: string; date: Date }[] = [];
  for (let w = 0; w < 12; w++) {
    if (w === 3 || w === 4) continue;
    const date = addDays(lastMonday, -7 * w);
    const id = `demo-s-${isoDate(date)}`;
    const present = active.filter((m) => rnd() < m.attendance).map((m) => m.id);
    const absent = active.filter((m) => !present.includes(m.id)).map((m) => m.id);
    const savedAt = at(date, 19, 40);
    record('sessions', id, { id, date: isoDate(date), present, absent, savedAt: savedAt.toISOString() }, w % 3 === 0 ? tobias : jana, 1, savedAt.getTime());
    dienste.push({ id, date });
  }

  // --- Aufgaben ---
  const task = (n: number, owner: string, shared: boolean, t: { title: string; description?: string; due?: number | null; priority?: 'low' | 'medium' | 'high'; done?: number; doneBy?: string; sessionId?: string; created: number }) => {
    const id = `demo-t-${pad(n)}`;
    const created = addDays(now, t.created);
    record(
      'tasks',
      id,
      {
        id,
        title: t.title,
        description: t.description ?? '',
        dueDate: t.due === undefined || t.due === null ? null : isoDate(addDays(now, t.due)),
        priority: t.priority ?? 'medium',
        completed: t.done !== undefined,
        createdAt: created.toISOString(),
        completedAt: t.done !== undefined ? addDays(now, t.done).toISOString() : null,
        sessionId: t.sessionId ?? null,
        shared,
        ownerId: owner,
        ...(t.doneBy ? { completedBy: t.doneBy } : {}),
      },
      owner,
      shared ? 1 : 0,
      created.getTime(),
    );
  };
  task(1, jana, true, { title: 'Anmeldung Kreiszeltlager abschicken', description: 'Teilnehmerliste steht im Protokoll der Betreuerbesprechung.', due: 4, priority: 'high', created: -9 });
  task(2, tobias, true, { title: 'Getränke für den Elternabend besorgen', due: 11, created: -6 });
  task(3, jana, true, { title: 'Leistungsspange: Gruppe beim Kreis anmelden', description: 'Meldeschluss beachten, Aufstellung aus der Wettkampf-Vorlage.', due: 18, priority: 'high', created: -3 });
  task(4, tobias, true, { title: 'Ersatz-Brusttücher bestellen', priority: 'low', created: -14 });
  task(5, tobias, true, { title: 'Fotos vom letzten Dienst in die Elterngruppe schicken', due: 1, sessionId: dienste[0]?.id, created: -1 });
  task(6, jana, true, { title: 'Schläuche nach der Übung zum Trocknen hängen', done: -6, doneBy: tobias, created: -8 });
  task(7, jana, true, { title: 'Erste-Hilfe-Auffrischung für Betreuer buchen', done: -12, doneBy: jana, priority: 'high', created: -30 });
  task(8, jana, false, { title: 'Dienstplan fürs nächste Halbjahr entwerfen', description: 'Privat: erst mit Tobias und Lena abstimmen, dann veröffentlichen.', due: 7, created: -2 });
  task(9, tobias, false, { title: 'Spieleideen für den Dienst vor Weihnachten sammeln', priority: 'low', created: -4 });

  // --- Kleidung ---
  for (const item of CLOTHING_ITEMS) record('clothingItems', item.id, item, jana, 1, t0 - 120 * DAY);
  const requests: Record<string, { item: string; step: number; passedOn: number | null; requested: number }[]> = {
    'demo-m-02': [{ item: 'kombi-jacke', step: 1, passedOn: null, requested: -5 }],
    'demo-m-04': [
      { item: 'kombi-jacke', step: 1, passedOn: null, requested: -12 },
      { item: 'kombi-hose', step: 1, passedOn: null, requested: -12 },
    ],
    'demo-m-08': [{ item: 'handschuhe', step: 1, passedOn: -20, requested: -26 }],
    'demo-m-10': [{ item: 'regenjacke', step: 1, passedOn: -20, requested: -30 }],
    'demo-m-12': [{ item: 'kombi-hose', step: 1, passedOn: null, requested: -2 }],
  };
  for (const m of MEMBERS) {
    if (m.kind !== 'jugendlich' || !m.active) continue;
    const sizeIn = (itemId: string, step = 0) => {
      const item = CLOTHING_ITEMS.find((i) => i.id === itemId)!;
      const base = itemId === 'handschuhe' ? Math.min(2 + Math.floor(m.size / 2), item.sizes.length - 1) : itemId === 'regenjacke' ? Math.min(m.size, item.sizes.length - 1) : m.size;
      return item.sizes[Math.min(base + step, item.sizes.length - 1)]!;
    };
    const items: Record<string, unknown> = {};
    for (const item of CLOTHING_ITEMS) {
      // Nicht jeder hat schon jedes Teil: Regenjacken fehlen bei den Jüngsten.
      if (item.id === 'regenjacke' && m.size < 2) continue;
      const req = requests[m.id]?.find((r) => r.item === item.id);
      items[item.id] = {
        current: sizeIn(item.id),
        request: req ? { size: sizeIn(item.id, req.step), requestedAt: isoDate(addDays(now, req.requested)), passedOn: req.passedOn === null ? null : isoDate(addDays(now, req.passedOn)) } : null,
      };
    }
    record('clothing', m.id, { id: m.id, items }, jana, 1, t0 - 2 * DAY);
  }

  // --- Wettkampf ---
  seedWettkampf(now, record, tobias);

  // --- Protokolle ---
  const putFolder = db.prepare('INSERT INTO folders(id, name, parentId, rev, updatedAt, deletedAt) VALUES(?,?,?,?,?,NULL)');
  for (const [id, name] of [
    ['demo-f-dienst', 'Dienstabende'],
    ['demo-f-team', 'Betreuerbesprechungen'],
    ['demo-f-eltern', 'Elternabende'],
  ]) putFolder.run(id!, name!, '', nextRev(db), t0 - 100 * DAY);

  const putProtocol = db.prepare(
    `INSERT INTO protocols(id, title, folderId, datum, beginn, ende, ort, leitung, content, ownerId, shared, hiddenRev, rev, updatedAt, deletedAt)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,NULL)`,
  );
  const protocol = (id: string, folderId: string, title: string, date: Date, times: [string, string], leitung: string, owner: string, shared: boolean, content: string) =>
    putProtocol.run(id, title, folderId, isoDate(date), times[0], times[1], 'Gerätehaus Musterstadt', leitung, content, owner, shared ? 1 : 0, nextRev(db), Math.min(at(date, 21).getTime(), t0));

  const d0 = dienste[0]?.date ?? addDays(now, -7);
  const d1 = dienste[1]?.date ?? addDays(now, -14);
  const d2 = dienste[2]?.date ?? addDays(now, -21);
  protocol('demo-p-dienst-knoten', 'demo-f-dienst', 'Dienst: Knoten und Stiche', d0, ['18:00', '19:30'], 'Tobias Wagner', tobias, true, doc(
    h2('Ablauf'),
    ul('Begrüßung, Anwesenheit per App erfasst', 'Wiederholung Mastwurf, Schotenstich, Kreuzknoten', 'Stationen in drei Gruppen, je 15 Minuten', 'Abschlussspiel: Knoten-Staffel'),
    h2('Beobachtungen'),
    p('Der Mastwurf sitzt bei fast allen. Beim ', text('Schotenstich', ['bold']), ' brauchen die Neuen noch Übung – nächste Woche zu Beginn fünf Minuten wiederholen.'),
    quote('Lob an die Älteren: Sie haben die Station mit den Neuen selbstständig betreut.'),
    h2('Nächste Schritte'),
    todo(['Zwei Knotenbretter reparieren', false], ['Übungsleinen zählen und beschriften', true]),
  ));
  protocol('demo-p-team', 'demo-f-team', 'Betreuerbesprechung', addDays(d1, 3), ['19:30', '21:00'], 'Jana Becker', jana, true, doc(
    p(text('Anwesend: ', ['bold']), 'Jana Becker, Tobias Wagner, Lena Schröder'),
    h2('Themen'),
    ol('Rückblick auf die letzten Dienste', 'Kreiszeltlager im Sommer', 'Training für die Leistungsspange', 'Neue Kleidung'),
    h2('Beschlüsse'),
    ul('Wir melden 12 Jugendliche und 3 Betreuer für das Kreiszeltlager an.', 'Ab sofort jeden zweiten Dienst 30 Minuten Training für die Leistungsspange.', 'Kleiderbestellung geht gesammelt Ende des Monats an den Kleiderwart.'),
    h2('Aufgaben'),
    todo(['Anmeldung Zeltlager (Jana)', false], ['Getränke Elternabend (Tobias)', false], ['Kleiderliste als PDF an den Kleiderwart (Lena)', true]),
  ));
  protocol('demo-p-dienst-hydrant', 'demo-f-dienst', 'Dienst: Wasserentnahme am Hydranten', d2, ['18:00', '19:45'], 'Jana Becker', jana, true, doc(
    h2('Inhalt'),
    p('Unterflurhydrant mit Standrohr gesetzt, Schlauchleitung zum Verteiler, zwei C-Rohre vorgenommen. Danach Aufbau wie im A-Teil des Bundeswettbewerbs.'),
    h2('Sicherheit'),
    ul('Helm, Handschuhe und festes Schuhwerk für alle', 'Straße mit zwei Leitkegeln abgesichert'),
    h2('Fazit'),
    p('Lief gut. ', text('Schlauchreserve', ['italic']), ' am Verteiler wurde mehrmals vergessen – beim nächsten Mal gezielt darauf achten.'),
  ));
  protocol('demo-p-eltern', 'demo-f-eltern', 'Elternabend Herbst', addDays(d2, -18), ['19:00', '20:30'], 'Jana Becker', jana, true, doc(
    h2('Tagesordnung'),
    ol('Vorstellung der Betreuer', 'Jahresplanung und Termine', 'Kleidung und Ausrüstung', 'Fragen der Eltern'),
    h2('Wichtigste Punkte'),
    ul('Dienst ist montags um 18:00 Uhr, im Sommerhalbjahr schon um 17:30 Uhr. In den Schulferien ist frei.', 'Die Kleidung bleibt Eigentum der Feuerwehr, Größenwechsel bitte bei den Betreuern melden.', 'Zum Zeltlager kommt ein eigener Elternbrief.'),
    h2('Fragen'),
    p('Mehrere Eltern fragten nach Fahrgemeinschaften zum Kreiszeltlager. Lena sammelt Angebote.'),
  ));
  protocol('demo-p-privat-jana', '', 'Notizen Jahresplanung (privat)', addDays(now, -2), ['20:00', ''], 'Jana Becker', jana, false, doc(
    p('Nur für mich, bis es mit dem Team abgestimmt ist. Mit „Veröffentlichen“ wird es für alle Betreuer sichtbar.'),
    ul('Februar: Erste Hilfe für die Jugendlichen', 'Mai: Leistungsspange', 'Juli: Kreiszeltlager', 'September: Berufsfeuerwehrtag'),
  ));
  protocol('demo-p-privat-tobias', '', 'Ideen Spieleabend (privat)', addDays(now, -4), ['21:15', ''], 'Tobias Wagner', tobias, false, doc(
    todo(['Schlauch-Kegeln', false], ['Feuerwehr-Activity', false], ['Knoten-Memory', true]),
  ));
}

type RecordFn = (collection: string, id: string, data: unknown, ownerId?: string, shared?: number, updatedAt?: number) => unknown;

const A_POSITIONS = ['gruppenfuehrer', 'melder', 'maschinist', 'angriffstruppfuehrer', 'angriffstruppmann', 'wassertruppfuehrer', 'wassertruppmann', 'schlauchtruppfuehrer', 'schlauchtruppmann'];

/** Fehler aus dem Schnellzugriff der App (gleiche IDs, Bezeichnungen und Punkte wie dort). */
const QUICK: Record<string, [label: string, points: number]> = {
  'a-q-psa': ['PSA-Mangel', 10],
  'a-q-kommando-frueh': ['Kommando zu früh', 5],
  'a-q-wassergraben': ['Fehler am Wassergraben', 5],
  'a-q-verdreht': ['Schlauchverdrehung', 5],
  'a-q-reserve': ['Schlauchreserve falsch', 5],
  'a-q-knoten-falsch': ['Knoten/Stich falsch', 5],
  'b-q-staffel': ['Staffelstab falsch übernommen', 10],
  'b-q-laufbrett': ['Laufbrett-Fehler', 5],
  'b-q-kuppeln': ['Kupplungs-/Knotenfehler', 5],
};

function fehlerList(counts: Record<string, number>) {
  return Object.entries(counts)
    .map(([id, count]) => ({ id, label: QUICK[id]![0], points: QUICK[id]![1], count, total: QUICK[id]![1] * count }))
    .sort((a, b) => b.total - a.total);
}

/** Läufe aus den letzten Wochen: der A-Teil wird schneller und sauberer, dazu B-Teil und Leistungsspange. */
function seedWettkampf(now: Date, record: RecordFn, owner: string): void {
  const kids = MEMBERS.filter((m) => m.kind === 'jugendlich' && m.active);
  const names = Object.fromEntries(kids.map((m) => [m.id, m.name]));
  const lineup = (prefix: string, keys: string[], offset: number) => Object.fromEntries(keys.map((k, i) => [`${prefix}${k}`, kids[(i + offset) % kids.length]!.id]));
  const aLineup = lineup('a-', A_POSITIONS, 0);
  const bLineup = lineup('b-laeufer-', ['1', '2', '3', '4', '5', '6', '7', '8', '9'], 3);
  const lspLineup = lineup('lsp-g-', A_POSITIONS, 5);

  record('lineupTemplates', 'demo-lt-a', { id: 'demo-lt-a', name: 'Stammbesetzung A-Teil', createdAt: addDays(now, -60).toISOString(), assignments: aLineup }, owner, 1, now.getTime() - 60 * DAY);
  record('lineupTemplates', 'demo-lt-b', { id: 'demo-lt-b', name: 'Staffel B-Teil', createdAt: addDays(now, -45).toISOString(), assignments: bLineup }, owner, 1, now.getTime() - 45 * DAY);

  const base = (n: number, daysAgo: number, mode: string, totalMs: number, assignments: Record<string, string>, notes: string) => {
    const stamp = at(addDays(now, -daysAgo), 19, 0).toISOString();
    return { id: `demo-r-${pad(n)}`, createdAt: stamp, updatedAt: stamp, mode, totalMs, notes, lineupSnapshot: { assignments, memberNames: names } };
  };

  const aRuns: [daysAgo: number, seconds: number, knot: number, fehler: Record<string, number>, notes: string][] = [
    [63, 418, 52, { 'a-q-knoten-falsch': 2, 'a-q-verdreht': 2, 'a-q-psa': 1, 'a-q-reserve': 1 }, 'Erster Durchgang nach der Sommerpause.'],
    [49, 401, 47, { 'a-q-knoten-falsch': 2, 'a-q-verdreht': 1, 'a-q-kommando-frueh': 1 }, ''],
    [35, 384, 44, { 'a-q-knoten-falsch': 1, 'a-q-verdreht': 1, 'a-q-wassergraben': 1 }, 'Wassergraben: Melder zu früh losgelaufen.'],
    [21, 371, 41, { 'a-q-reserve': 2 }, 'Schlauchreserve am Verteiler vergessen.'],
    [14, 362, 39, { 'a-q-knoten-falsch': 1 }, ''],
    [7, 349, 36, {}, 'Fehlerfrei! Nächstes Ziel: unter 5:45.'],
  ];
  aRuns.forEach(([daysAgo, seconds, knot, counts, notes], i) => {
    const fehler = fehlerList(counts);
    const fehlerpunkte = fehler.reduce((s, f) => s + f.total, 0);
    const totalMs = seconds * 1000 + 300 + i * 70;
    record('runs', `demo-r-${pad(i + 1)}`, {
      ...base(i + 1, daysAgo, 'a', totalMs, aLineup, notes),
      wasserentnahme: 'saug',
      markers: [
        { id: `demo-r-${pad(i + 1)}-m1`, label: 'zu Wasser', elapsedMs: Math.round(totalMs * 0.38) },
        { id: `demo-r-${pad(i + 1)}-m2`, label: 'Knoten Start', elapsedMs: totalMs - knot * 1000 - 4000 },
      ],
      knotDurationMs: knot * 1000,
      taskTimers: {},
      scoring: { mode: 'a', vorgabe: 1000, fehlerpunkte, istSeconds: Math.round(totalMs / 1000), targetSeconds: null, timeAdjust: 0, total: Math.max(0, 1000 - fehlerpunkte), fehler },
      lsp: null,
    }, owner, 1, now.getTime() - daysAgo * DAY);
  });

  const bRuns: [daysAgo: number, seconds: number, fehler: Record<string, number>][] = [
    [42, 84, { 'b-q-staffel': 1, 'b-q-laufbrett': 1 }],
    [28, 81, { 'b-q-kuppeln': 1 }],
    [14, 77, {}],
  ];
  bRuns.forEach(([daysAgo, seconds, counts], i) => {
    const n = aRuns.length + i + 1;
    const fehler = fehlerList(counts);
    const fehlerpunkte = fehler.reduce((s, f) => s + f.total, 0);
    const totalMs = seconds * 1000 + 450;
    const istSeconds = Math.round(totalMs / 1000);
    const targetSeconds = 80;
    const timeAdjust = targetSeconds - istSeconds;
    record('runs', `demo-r-${pad(n)}`, {
      ...base(n, daysAgo, 'b', totalMs, bLineup, i === 2 ? 'Neue Bestzeit.' : ''),
      markers: [],
      knotDurationMs: null,
      taskTimers: {
        Schlauchrollen: { startElapsedMs: 21_000, endElapsedMs: 21_000 + (14 - i) * 1000 },
        'L7/L8 Team': { startElapsedMs: 52_000, endElapsedMs: 52_000 + (9 - i) * 1000 },
        Anziehen: { startElapsedMs: 63_000, endElapsedMs: 63_000 + (12 - i) * 1000 },
      },
      scoring: { mode: 'b', vorgabe: 400, fehlerpunkte, istSeconds, targetSeconds, timeAdjust, total: Math.max(0, 400 - fehlerpunkte + timeAdjust), fehler },
      lsp: null,
    }, owner, 1, now.getTime() - daysAgo * DAY);
  });

  // Leistungsspange (Gruppe): Punkte nach den Tabellen der App (Schnelligkeit bis 55 s = 4, bis 60 s = 3; Staffellauf bis 225 s = 3; Kugel bis 70 m = 3).
  const lspRuns: [daysAgo: number, mode: string, totalMs: number, basis: Record<string, unknown>, punkte: number, notes: string][] = [
    [20, 'lsp-schnelligkeit', 58_400, { art: 'zeit', sekunden: 58.4 }, 3, 'Kupplungen 5 und 6 haben gehakt.'],
    [6, 'lsp-schnelligkeit', 54_200, { art: 'zeit', sekunden: 54.2 }, 4, ''],
    [13, 'lsp-staffellauf', 218_600, { art: 'zeit', sekunden: 218.6 }, 3, ''],
    [13, 'lsp-kugelstossen', 0, { art: 'weite', zentimeter: 6650 }, 3, 'Gesamtweite aller neun Stöße.'],
  ];
  lspRuns.forEach(([daysAgo, mode, totalMs, basis, punkte, notes], i) => {
    const n = aRuns.length + bRuns.length + i + 1;
    record('runs', `demo-r-${pad(n)}`, {
      ...base(n, daysAgo, mode, totalMs, lspLineup, notes),
      markers: [],
      knotDurationMs: null,
      taskTimers: {},
      scoring: null,
      lsp: { variante: 'gruppe', punkte, basis, nullwertung: false, gruende: [], beobachtungen: [] },
    }, owner, 1, now.getTime() - daysAgo * DAY);
  });
}
