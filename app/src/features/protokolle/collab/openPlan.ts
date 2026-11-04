import * as Y from 'yjs';
import { db, type HubDb, type YDocRow } from '@/core/db/db';
import { baseProblem, buildBase, isEmptySnapshot } from './base';
import type { Protokoll } from '../model';
import { repairDoc } from './repair';
import { CollabSession, type SessionOptions, type SessionStart } from './session';
import { answerOf, type ExchangeTransport } from './wire';
import { docProblem } from './yJson';
import { applyAnswer, compact, genOf, putBase, putLocal } from './yStore';

/**
 * Was passiert, wenn ein Protokoll im Editor geöffnet wird? Der Editor bindet sich immer an ein Yjs-Dokument; die Frage ist, woher es
 * kommt. Entscheidend: Es gibt genau eine Quelle für die Basis eines Dokuments mit Inhalt (der Server beim Umstellen, hier nur für
 * Protokolle, die er noch nie bekommen hat). Zwei Basen mit demselben Inhalt zusammenzuführen würde ihn verdoppeln.
 */
export type OpenPlan =
  /** Das Protokoll gibt es nicht (mehr). */
  | 'gone'
  /** Der Server hat den Text noch nicht umgestellt: nur lesen. */
  | 'legacy'
  /** Dieses Gerät hat schon einen Zustand: an ihn binden. */
  | 'bind'
  /** Kein Inhalt: leeres Dokument ohne Basis (der erste Absatz entsteht beim Tippen, zwei leere Anfänge lassen sich gefahrlos zusammenführen). */
  | 'empty'
  /** Nie gesendet (oder kein Server): die Basis aus dem Schnappschuss bauen. */
  | 'base'
  /** Der Server kennt das Protokoll: seinen Zustand holen, nie selbst eine Basis bauen. */
  | 'fetch';

export function planOpen(row: Protokoll | undefined, hasState: boolean, hasServer: boolean): OpenPlan {
  if (!row || row.deleted === 1) return 'gone';
  if (row.legacy) return 'legacy';
  if (hasState) return 'bind';
  if (isEmptySnapshot(row.content)) return 'empty';
  return row.rev === 0 || !hasServer ? 'base' : 'fetch';
}

export type ReadonlyReason = 'gone' | 'legacy' | 'unreadable' | 'needs-server' | 'failed';

export type Opened = { kind: 'edit'; session: CollabSession } | { kind: 'readonly'; reason: ReadonlyReason; message: string };

export interface OpenDeps {
  store?: HubDb;
  transport: ExchangeTransport;
  /** Ist ein Server mit Anmeldung eingerichtet? Ohne (Browser-Demo, Android ohne Server) bleibt alles auf dem Gerät. */
  hasServer: () => Promise<boolean>;
  /** Weitere Angaben für die Bearbeitung (Hochladen vor dem Senden, Abfragen des Editors …). */
  session?: Omit<SessionOptions, 'store' | 'transport'>;
  /** Wie lange das Öffnen auf den Server wartet, wenn dieses Gerät den Text noch nicht hat (Millisekunden). Danach gibt es die Nur-lesen-Ansicht. */
  openTimeoutMs?: number;
}

/** Wartet auf `p`, höchstens `ms` Millisekunden; danach ein Fehler (das späte Ergebnis wird nicht mehr gebraucht). */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Zeitüberschreitung')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const UNREADABLE = (why: string): string =>
  `Dieses Protokoll enthält Elemente, die diese App-Version nicht kennt (${why}). Es wird nur gelesen und nicht verändert. Bitte die App aktualisieren, um es zu bearbeiten.`;

/**
 * Bereitet das Bearbeiten vor: bestimmt das Dokument (siehe `planOpen`), prüft, ob der Editor es ohne Verlust bauen kann, und legt die
 * Sitzung an (noch nicht gestartet). Der Editor bindet sich nie an ein Dokument, das diese Prüfung nicht besteht: `@tiptap/y-tiptap`
 * würde aus dem geteilten Dokument löschen, was es nicht bauen kann.
 */
export async function openProtocol(id: string, deps: OpenDeps): Promise<Opened> {
  try {
    return await openPlanned(id, deps);
  } catch (e) {
    // Ein Fehler beim Öffnen (beschädigte Zeile, Speicherfehler auf dem Gerät) darf nicht als leere Seite enden: Der Text bleibt unberührt.
    const why = e instanceof Error && e.message ? ` (${e.message})` : '';
    return { kind: 'readonly', reason: 'failed', message: `Das Protokoll ließ sich nicht öffnen${why}. Bitte noch einmal versuchen.` };
  }
}

async function openPlanned(id: string, deps: OpenDeps): Promise<Opened> {
  const store = deps.store ?? db;
  const row = await store.protokolle.get(id);
  const hasState = !!(await store.ydocs.get(id));
  const plan = planOpen(row, hasState, await deps.hasServer());
  const readonly = (reason: ReadonlyReason, message: string): Opened => ({ kind: 'readonly', reason, message });
  const session = (doc: Y.Doc, start: SessionStart): Opened => ({ kind: 'edit', session: new CollabSession(id, doc, start, { ...deps.session, store, transport: deps.transport }) });

  switch (plan) {
    case 'gone':
      return readonly('gone', 'Dieses Protokoll gibt es nicht (mehr).');
    case 'legacy':
      return readonly('legacy', 'Der Server hat den Text dieses Protokolls noch nicht für das gemeinsame Bearbeiten umgestellt. Es wird nur gelesen.');
    case 'empty':
      return session(new Y.Doc(), { rev: undefined, seq: 0, gen: undefined });
    case 'base': {
      const problem = baseProblem(row!.content);
      if (problem) return readonly('unreadable', UNREADABLE(problem));
      const stored = await putBase(id, buildBase(row!.content), store);
      return fromState(id, stored, undefined, store, session, readonly);
    }
    case 'fetch': {
      let res;
      try {
        res = await within(deps.transport({ docs: [{ id }] }), deps.openTimeoutMs ?? 15_000);
      } catch {
        return readonly('needs-server', 'Zum Bearbeiten muss dieses Protokoll erst mit dem Server abgeglichen werden. Der Text wird nur gelesen, bis eine Verbindung besteht.');
      }
      const r = res.docs.find((d) => d.id === id);
      if (res.reset || !r) return readonly('needs-server', 'Der Server wurde ersetzt oder zurückgesetzt. Bitte zuerst abgleichen.');
      if (r.status === 'gone') return readonly('gone', 'Dieses Protokoll wurde gelöscht oder von jemand anderem zurückgezogen.');
      if (r.status === 'legacy') return readonly('legacy', 'Der Server hat den Text dieses Protokolls noch nicht für das gemeinsame Bearbeiten umgestellt. Es wird nur gelesen.');
      if (r.status !== 'ok') return readonly('needs-server', 'Der Server konnte den Text gerade nicht liefern. Bitte später noch einmal öffnen.');
      const stored = await applyAnswer(id, answerOf(r), undefined, store); // eigener Text war nicht Teil der Anfrage
      return fromState(id, stored, r.rev, store, session, readonly);
    }
    case 'bind': {
      await compact(id, store);
      const stored = await store.ydocs.get(id);
      if (!stored) throw new Error('Der Text liegt nicht mehr auf diesem Gerät');
      return fromState(id, stored, row!.textRev, store, session, readonly);
    }
  }
}

async function fromState(
  id: string,
  stored: YDocRow,
  rev: number | undefined,
  store: HubDb,
  session: (doc: Y.Doc, start: SessionStart) => Opened,
  readonly: (reason: ReadonlyReason, message: string) => Opened,
): Promise<Opened> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, stored.update);
  const problem = docProblem(doc);
  if (!problem) return session(doc, { rev, seq: stored.seq, gen: genOf(stored) });
  // Gleichzeitige Strukturänderungen können gegen die Inhaltsregeln verstoßen (eine Liste, aus der zwei Personen je einen Punkt gestrichen
  // haben, ist leer). Das Ergänzen leerer Teile (`repairDoc`) löscht nichts; erst wenn das Ergebnis besteht, wird es gesichert (und geht als
  // Änderung dieses Geräts zum Server) und gebunden. Sonst bleibt das Protokoll unberührt gesperrt.
  const before = Y.encodeStateVector(doc);
  if (repairDoc(doc) && !docProblem(doc)) {
    const seq = await putLocal(id, Y.encodeStateAsUpdate(doc, before), store);
    return session(doc, { rev, seq, gen: genOf(stored) });
  }
  doc.destroy();
  return readonly('unreadable', UNREADABLE(problem));
}
