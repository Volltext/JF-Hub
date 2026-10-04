import { useState, type FormEvent } from 'react';
import { Button, Sheet } from '@/core/ui/components';

/** Kleines Eingabefenster für einen Namen (statt `prompt()`). */
export function NameSheet(props: { title: string; initial?: string; confirmLabel: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(props.initial ?? '');
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) props.onSubmit(name.trim());
  }
  return (
    <Sheet title={props.title} onClose={props.onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
        <Button variant="primary" type="submit" disabled={!name.trim()}>
          {props.confirmLabel}
        </Button>
      </form>
    </Sheet>
  );
}
