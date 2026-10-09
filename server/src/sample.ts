import { toServerDoc } from './sync.js';

/** Beispielprotokoll für die Layout-Vorschau in der Admin-GUI. */
export function sampleProtocol() {
  const t = (text: string, marks?: { type: string }[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
  const li = (text: string) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [t(text)] }] });
  const ti = (text: string, checked: boolean) => ({ type: 'taskItem', attrs: { checked }, content: [{ type: 'paragraph', content: [t(text)] }] });
  return toServerDoc({
    id: 'preview',
    title: 'Beispielprotokoll',
    folderId: '',
    datum: new Date().toISOString().slice(0, 10),
    beginn: '17:30',
    ende: '19:00',
    ort: 'Gerätehaus',
    leitung: 'Max Mustermann',
    content: JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [t('Begrüßung')] },
        { type: 'paragraph', content: [t('Normaler Text mit '), t('fett', [{ type: 'bold' }]), t(', '), t('kursiv', [{ type: 'italic' }]), t(' und '), t('unterstrichen', [{ type: 'underline' }]), t('.')] },
        { type: 'heading', attrs: { level: 2 }, content: [t('Beschlüsse')] },
        { type: 'bulletList', content: [li('Erster Punkt'), li('Zweiter Punkt')] },
        { type: 'taskList', content: [ti('Erledigt', true), ti('Offen', false)] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [t('Ein Zitat oder eine Anmerkung.')] }] },
      ],
    }),
    ownerId: '',
    shared: 1,
    hiddenRev: null,
    rev: 0,
    updatedAt: Date.now(),
    deletedAt: null,
    conflictRev: null,
    purgedAt: null,
  });
}
