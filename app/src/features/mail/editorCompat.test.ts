import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { baseProblem, buildBase } from '@/features/protokolle/collab/base';
import { docProblem, FIELD } from '@/features/protokolle/collab/yJson';
import { schemaAccepts } from '@/features/protokolle/editorSchema';
import { blobIdsIn } from '@/core/domain/blobRefs';
import { docFromMail, attachmentBlocks } from './toProtocol';

/** Der Inhalt, den die Mail-Übernahme erzeugt, muss genau das sein, was der echte Editor lädt: sonst bliebe das Protokoll nur lesbar. */
const sample = docFromMail(
  { from: { name: 'Anna', address: 'a@example.org' }, date: new Date(2026, 10, 3, 14, 30).toISOString(), text: 'Hallo Welt\n\nZweiter Absatz\n  eingerückt  ' },
  [
    { blobId: 'blob-file-1', name: 'Dienstplan 2027.pdf', mime: 'application/pdf', size: 20_000 },
    { blobId: 'blob-photo-1', name: 'Foto.png', mime: 'image/jpeg', size: 900, photo: { w: 1200, h: 800 } },
  ],
);

describe('Inhalt aus einer Mail passt zum Editor', () => {
  it('besteht die Vokabular-Prüfung und lässt sich als Yjs-Dokument bauen', () => {
    expect(baseProblem(sample)).toBeNull();
    expect(schemaAccepts(sample)).toBe(true);
    const state = buildBase(sample);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    expect(doc.getXmlFragment(FIELD).length).toBeGreaterThan(3);
    expect(docProblem(doc)).toBeNull();
  });

  it('der Verweis auf die Anhänge wird erkannt (damit der Server sie dem Protokoll zuordnet)', () => {
    expect(blobIdsIn(sample).sort()).toEqual(['blob-file-1', 'blob-photo-1']);
  });

  it('auch Anhänge allein (an ein vorhandenes Protokoll gehängt) sind gültig', () => {
    const only = { type: 'doc', content: attachmentBlocks([{ blobId: 'x1', name: 'a.zip', mime: 'application/zip', size: 5 }]) };
    expect(baseProblem(only)).toBeNull();
  });
});
