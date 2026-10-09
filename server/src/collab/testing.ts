import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import * as Y from 'yjs';
import { refreshRefs } from '../blobs.js';
import { nextRev } from '../db.js';
import { jsonToYDoc, yDocToJson, type DocNode } from './convert.js';

/** Hilfen für Tests (nicht Teil des Servers). */
export interface PutOptions {
  id?: string;
  title?: string;
  ownerId?: string;
  shared?: boolean;
  folderId?: string;
  datum?: string;
  /** Inhalt als ProseMirror-JSON. Mit `ymode: 1` entsteht daraus der Y-Zustand, sonst steht er als JSON in der Zeile. */
  content?: DocNode;
  /** 1 (Vorgabe): Text als Yjs-Dokument. 0: Zeile wie vor 3.0.0 (nur `content`). */
  ymode?: 0 | 1;
  /** Gelöscht (im Papierkorb). */
  deleted?: boolean;
  /** Geleert (Grabstein). */
  purged?: boolean;
  /** Zeitpunkte je Kopffeld. */
  metaAt?: Record<string, number>;
  updatedAt?: number;
}

/** Legt ein Protokoll an, wie der Server es nach der Umstellung auf Yjs speichert. Liefert die ID. */
export function putProtocol(db: DatabaseSync, opts: PutOptions = {}): string {
  const id = opts.id ?? randomUUID().replace(/-/g, '');
  const ymode = opts.ymode ?? 1;
  const now = opts.updatedAt ?? Date.now();
  let content: DocNode = opts.content ?? { type: 'doc', content: [] };
  let ydoc: Y.Doc | undefined;
  if (ymode === 1 && opts.content) {
    ydoc = jsonToYDoc(opts.content);
    content = yDocToJson(ydoc);
  }
  db.prepare(
    `INSERT INTO protocols(id, title, folderId, datum, beginn, ende, ort, leitung, content, ownerId, shared, hiddenRev, rev, updatedAt, deletedAt, purgedAt, ymode, metaAt)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?)`,
  ).run(
    id,
    opts.title ?? '',
    opts.folderId ?? '',
    opts.datum ?? '2026-10-01',
    '',
    '',
    '',
    '',
    JSON.stringify(content),
    opts.ownerId ?? '',
    opts.shared === false ? 0 : 1,
    nextRev(db),
    now,
    opts.deleted ? now : null,
    opts.purged ? now : null,
    ymode,
    JSON.stringify(opts.metaAt ?? {}),
  );
  if (ydoc) {
    db.prepare('INSERT INTO ydocs(id, state, sv, updatedAt) VALUES(?,?,?,?)').run(id, Y.encodeStateAsUpdate(ydoc), Y.encodeStateVector(ydoc), now);
    refreshRefs(db, id, content);
  }
  return id;
}

/** Der Text eines Y-Dokuments (alle Textknoten, durch Leerzeichen getrennt) – zum Vergleichen in Tests. */
export function textOf(doc: Y.Doc | DocNode): string {
  const out: string[] = [];
  const walk = (n: DocNode) => {
    if (n.text) out.push(n.text);
    n.content?.forEach(walk);
  };
  walk(doc instanceof Y.Doc ? yDocToJson(doc) : doc);
  return out.join(' ');
}
