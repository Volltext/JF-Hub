import { useState, type FormEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { Button, Sheet } from '@/core/ui/components';
import { displayUrl, normalizeUrl } from './linkUrl';

/**
 * Link setzen, ändern oder entfernen. Steht der Cursor in einem Link, wird dieser bearbeitet; sonst gilt der Link für die
 * Auswahl, und ohne Auswahl wird ein neuer Linktext eingefügt.
 */
export function LinkSheet({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [initial] = useState(() => ({
    href: editor.isActive('link') ? String(editor.getAttributes('link').href ?? '') : '',
    selection: !editor.state.selection.empty,
  }));
  const editing = !!initial.href;
  const [url, setUrl] = useState(initial.href);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const href = normalizeUrl(url);
    if (!href) {
      setError('Das ist keine gültige Adresse. Erlaubt sind Webadressen (zum Beispiel beispiel.de), E-Mail-Adressen und Telefonnummern.');
      return;
    }
    onClose();
    const chain = editor.chain().focus();
    if (editing) chain.extendMarkRange('link').setLink({ href }).run();
    else if (initial.selection) chain.setLink({ href }).run();
    else chain.insertContent({ type: 'text', text: label.trim() || displayUrl(href, 80), marks: [{ type: 'link', attrs: { href } }] }).run();
  }

  function remove() {
    onClose();
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
  }

  return (
    <Sheet title={editing ? 'Link ändern' : 'Link'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Adresse</span>
          <input
            autoFocus
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={2000}
            placeholder="beispiel.de, name@beispiel.de oder Telefonnummer"
            value={url}
            aria-invalid={!!error}
            aria-describedby={error ? 'link-error' : undefined}
            onChange={(e) => {
              setUrl(e.target.value);
              setError('');
            }}
            onFocus={(e) => e.target.select()}
          />
        </label>
        {!editing && !initial.selection && (
          <label className="field">
            <span>Text (optional)</span>
            <input maxLength={200} placeholder="Wird sonst aus der Adresse gebildet" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
        )}
        {error && (
          <p id="link-error" role="alert" className="proto-error">
            {error}
          </p>
        )}
        <Button variant="primary" type="submit" disabled={!url.trim()}>
          {editing ? 'Übernehmen' : 'Link einfügen'}
        </Button>
        {editing && (
          <Button type="button" variant="danger" onClick={remove}>
            Link entfernen
          </Button>
        )}
      </form>
    </Sheet>
  );
}
