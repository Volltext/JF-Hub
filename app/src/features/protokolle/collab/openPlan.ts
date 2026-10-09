import * as Y from 'yjs';
import { db, type HubDb } from '@/core/db/db';
import { baseProblem, buildBase, isEmptySnapshot } from './base';
import type { Protokoll } from '../model';
import { CollabSession, type SessionOptions } from './session';
import { answerOf, type ExchangeTransport } from './wire';
import { docProblem } from './yJson';
import { applyAnswer, compact, putBase } from './yStore';

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

export type ReadonlyReason = 'gone' | 'legacy' | 'unreadable' | 'needs-server';

export type Opened = { kind: 'edit'; session: CollabSession } | { kind: 'readonly'; reason: ReadonlyReason; message: string };

export interface OpenDeps {
  store?: HubDb;
  transport: ExchangeTransport;
  /** Ist ein Server mit Anmeldung eingerichtet? Ohne (Browser-Demo, Android ohne Server) bleibt alles auf dem Gerät. */
  hasServer: () => Promise<boolean>;
  /** Weitere Angaben für die Bearbeitung (Hochladen vor dem Senden, Abfragen des Editors …). */
  session?: Omit<SessionOptions, 'store' | 'transport'>;
}

const UNREADABLE = (why: string): string =>
  `Dieses Protokoll enthält Elemente, die diese App-Version nicht kennt (${why}). Es wird nur gelesen und nicht verändert. Bitte die App aktualisieren, um es zu bearbeiten.`;

/**
 * Bereitet das Bearbeiten vor: bestimmt das Dokument (siehe `planOpen`), prüft, ob der Editor es ohne Verlust bauen kann, und legt die
 * Sitzung an (noch nicht gestartet). Der Editor bindet sich nie an ein Dokument, das diese Prüfung nicht besteht: `@tiptap/y-tiptap`
 * würde aus dem geteilten Dokument löschen, was es nicht bauen kann.
 */
export async function openProtocol(id: string, deps: OpenDeps): Promise<Opened> {
  const store = deps.store ?? db;
  const row = await store.protokolle.get(id);
  const hasState = !!(await store.ydocs.get(id));
  const plan = planOpen(row, hasState, await deps.hasServer());
  const readonly = (reason: ReadonlyReason, message: string): Opened => ({ kind: 'readonly', reason, message });
  const session = (doc: Y.Doc, rev: number | undefined): Opened => ({ kind: 'edit', session: new CollabSession(id, doc, rev, { ...deps.session, store, transport: deps.transport }) });

  switch (plan) {
    case 'gone':
      return readonly('gone', 'Dieses Protokoll gibt es nicht (mehr).');
    case 'legacy':
      return readonly('legacy', 'Der Server hat den Text dieses Protokolls noch nicht für das gemeinsame Bearbeiten umgestellt. Es wird nur gelesen.');
    case 'empty':
      return session(new Y.Doc(), undefined);
    case 'base': {
      const problem = baseProblem(row!.content);
      if (problem) return readonly('unreadable', UNREADABLE(problem));
      const stored = await putBase(id, buildBase(row!.content), store);
      return fromState(stored.update, undefined, session, readonly);
    }
    case 'fetch': {
      let res;
      try {
        res = await deps.transport({ docs: [{ id }] });
      } catch {
        return readonly('needs-server', 'Zum Bearbeiten muss dieses Protokoll erst mit dem Server abgeglichen werden. Der Text wird nur gelesen, bis eine Verbindung besteht.');
      }
      const r = res.docs.find((d) => d.id === id);
      if (res.reset || !r) return readonly('needs-server', 'Der Server wurde ersetzt oder zurückgesetzt. Bitte zuerst abgleichen.');
      if (r.status === 'gone') return readonly('gone', 'Dieses Protokoll wurde gelöscht oder von jemand anderem zurückgezogen.');
      if (r.status === 'legacy') return readonly('legacy', 'Der Server hat den Text dieses Protokolls noch nicht für das gemeinsame Bearbeiten umgestellt. Es wird nur gelesen.');
      if (r.status !== 'ok') return readonly('needs-server', 'Der Server konnte den Text gerade nicht liefern. Bitte später noch einmal öffnen.');
      const stored = await applyAnswer(id, answerOf(r), 0, store);
      return fromState(stored.update, r.rev, session, readonly);
    }
    case 'bind': {
      await compact(id, store);
      const stored = (await store.ydocs.get(id))!;
      return fromState(stored.update, row!.textRev, session, readonly);
    }
  }
}

function fromState(update: Uint8Array, rev: number | undefined, session: (doc: Y.Doc, rev: number | undefined) => Opened, readonly: (reason: ReadonlyReason, message: string) => Opened): Opened {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const problem = docProblem(doc);
  if (problem) {
    doc.destroy();
    return readonly('unreadable', UNREADABLE(problem));
  }
  return session(doc, rev);
}
