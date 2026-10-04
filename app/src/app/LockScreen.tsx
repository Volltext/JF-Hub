import { useState } from 'react';
import { pin } from '@/core/settings/pin';

const MAX = 6;

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    if (await pin.verify(value)) return onUnlock();
    setError('Falsche PIN');
    setValue('');
    navigator.vibrate?.(80);
  }

  function press(d: string) {
    setError('');
    const next = (value + d).slice(0, MAX);
    setValue(next);
    if (next.length >= 4) void pin.verify(next).then((ok) => ok && onUnlock());
  }

  return (
    <div className="lock">
      <h1>JF Hub</h1>
      <div className="lock__dots" aria-label={`${value.length} Ziffern eingegeben`}>
        {Array.from({ length: MAX }, (_, i) => (
          <span key={i} className={`lock__dot ${i < value.length ? 'lock__dot--on' : ''}`} />
        ))}
      </div>
      <div className="lock__error" role="alert">
        {error}
      </div>
      <div className="lock__pad">
        {'123456789'.split('').map((d) => (
          <button key={d} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button onClick={() => setValue(value.slice(0, -1))} aria-label="Löschen">
          ⌫
        </button>
        <button onClick={() => press('0')}>0</button>
        <button onClick={submit} aria-label="Bestätigen">
          OK
        </button>
      </div>
    </div>
  );
}
