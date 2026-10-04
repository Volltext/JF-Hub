import { useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import {
  MONTH_NAMES,
  WEEKDAYS,
  formatTime,
  monthGrid,
  parseIso,
  parseTime,
  shiftMonth,
} from '@/core/domain/calendar';
import { formatDate } from '@/core/domain/format';
import { nowTime, parseTypedTime } from '@/core/domain/time';
import { todayIso } from '@/core/domain/id';
import { Button, Sheet } from './components';

/** Eigene Auswahl-, Zeit- und Datumsfelder im App-Design – ersetzen die Standard-Elemente von Android. */

interface FieldShellProps {
  label: string;
  children: React.ReactNode;
}
const Shell = ({ label, children }: FieldShellProps) => (
  <div className="field">
    <span>{label}</span>
    {children}
  </div>
);

function PickerButton(props: { text: string; placeholder?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="picker-btn" disabled={props.disabled} onClick={props.onClick} aria-haspopup="dialog">
      <span style={props.placeholder ? { color: 'var(--muted)' } : undefined}>{props.text}</span>
      <ChevronDown size={18} />
    </button>
  );
}

// ---------- Auswahl ----------

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = props.options.find((o) => o.value === props.value);
  return (
    <Shell label={props.label}>
      <PickerButton text={current?.label ?? '–'} placeholder={!current || current.value === ''} disabled={props.disabled} onClick={() => setOpen(true)} />
      {open && (
        <Sheet title={props.label} onClose={() => setOpen(false)}>
          <div className="list">
            {props.options.map((o) => (
              <button
                key={o.value}
                type="button"
                className="toggle"
                aria-pressed={o.value === props.value}
                onClick={() => {
                  props.onChange(o.value);
                  setOpen(false);
                }}
              >
                <span className="toggle__box">{o.value === props.value && <Check size={14} />}</span>
                {o.label || '–'}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </Shell>
  );
}

// ---------- Uhrzeit ----------

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const two = (n: number) => String(n).padStart(2, '0');

/**
 * Uhrzeit wählen: Stunde antippen, dann Minute antippen – fertig. Alternativ tippen („1730“),
 * mit ± minutengenau einstellen oder „Jetzt“ übernehmen. Ohne bisherigen Wert startet die Auswahl bei der aktuellen Zeit.
 */
export function TimeField(props: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Shell label={props.label}>
      <PickerButton
        text={props.value ? `${props.value} Uhr` : 'Uhrzeit wählen'}
        placeholder={!props.value}
        disabled={props.disabled}
        onClick={() => setOpen(true)}
      />
      {open && (
        <TimeSheet
          title={props.label}
          value={props.value}
          onPick={(v) => {
            props.onChange(v);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </Shell>
  );
}

function TimeSheet(props: { title: string; value: string; onPick: (v: string) => void; onClose: () => void }) {
  const initial = props.value ? parseTime(props.value) : parseTypedTime(nowTime())!;
  const [t, setT] = useState(initial);
  const [text, setText] = useState(formatTime(initial.h, initial.min));
  const fine = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

  const set = (next: { h: number; min: number }) => {
    setT(next);
    setText(formatTime(next.h, next.min));
  };
  const step = (delta: number) => {
    const total = (t.h * 60 + t.min + delta + 1440) % 1440;
    set({ h: Math.floor(total / 60), min: total % 60 });
  };

  return (
    <Sheet title={props.title} onClose={props.onClose}>
      <form
        className="tp"
        onSubmit={(e) => {
          e.preventDefault();
          props.onPick(formatTime(t.h, t.min));
        }}
      >
        <div className="tp-display">
          <button type="button" className="stepper-btn" aria-label="Eine Minute früher" onClick={() => step(-1)}>
            <Minus size={18} />
          </button>
          <input
            className="tp-input"
            inputMode="numeric"
            aria-label="Uhrzeit eintippen"
            value={text}
            autoFocus={fine}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              setText(e.target.value);
              const p = parseTypedTime(e.target.value);
              if (p) setT(p);
            }}
          />
          <button type="button" className="stepper-btn" aria-label="Eine Minute später" onClick={() => step(1)}>
            <Plus size={18} />
          </button>
        </div>

        <div className="group-label">Stunde</div>
        <div className="tp-grid">
          {HOURS.map((h) => (
            <button key={h} type="button" className="tp-cell" aria-pressed={h === t.h} onClick={() => set({ h, min: t.min })}>
              {two(h)}
            </button>
          ))}
        </div>

        <div className="group-label">Minute (antippen übernimmt die Zeit)</div>
        <div className="tp-grid">
          {MINUTES.map((min) => (
            <button key={min} type="button" className="tp-cell" aria-pressed={min === t.min} onClick={() => props.onPick(formatTime(t.h, min))}>
              {two(min)}
            </button>
          ))}
        </div>

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Button type="button" onClick={() => props.onPick(nowTime())}>
            Jetzt
          </Button>
          <Button variant="primary" type="submit">
            {formatTime(t.h, t.min)} Uhr übernehmen
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
// ---------- Datum ----------

export function DateField(props: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  /** Spätestes wählbares Datum (YYYY-MM-DD). */
  max?: string;
  /** Erlaubt „Kein Datum“. */
  clearable?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Shell label={props.label}>
      <PickerButton
        text={props.value ? formatDate(props.value, true) : props.clearable ? 'Kein Datum' : 'Datum wählen'}
        placeholder={!props.value}
        disabled={props.disabled}
        onClick={() => setOpen(true)}
      />
      {open && (
        <CalendarSheet
          title={props.label}
          value={props.value}
          max={props.max}
          clearable={props.clearable}
          onPick={(v) => {
            props.onChange(v);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </Shell>
  );
}

function CalendarSheet(props: {
  title: string;
  value: string | null;
  max?: string;
  clearable?: boolean;
  onPick: (v: string | null) => void;
  onClose: () => void;
}) {
  const start = parseIso(props.value ?? '') ?? parseIso(todayIso())!;
  const [view, setView] = useState({ y: start.y, m: start.m });
  const today = todayIso();
  const grid = monthGrid(view.y, view.m);

  return (
    <Sheet title={props.title} onClose={props.onClose}>
      <div className="cal-head">
        <button type="button" className="stepper-btn" aria-label="Voriger Monat" onClick={() => setView((v) => shiftMonth(v.y, v.m, -1))}>
          <ChevronLeft size={20} />
        </button>
        <strong>
          {MONTH_NAMES[view.m]} {view.y}
        </strong>
        <button type="button" className="stepper-btn" aria-label="Nächster Monat" onClick={() => setView((v) => shiftMonth(v.y, v.m, 1))}>
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="cal-grid" role="grid">
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-dow">
            {d}
          </div>
        ))}
        {grid.flat().map((iso, i) =>
          iso ? (
            <button
              key={iso}
              type="button"
              className={`cal-day ${iso === props.value ? 'cal-day--on' : ''} ${iso === today ? 'cal-day--today' : ''}`}
              disabled={!!props.max && iso > props.max}
              aria-label={formatDate(iso, true)}
              aria-pressed={iso === props.value}
              onClick={() => props.onPick(iso)}
            >
              {Number(iso.slice(8))}
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Button disabled={!!props.max && today > props.max} onClick={() => props.onPick(today)}>
          Heute
        </Button>
        {props.clearable && <Button onClick={() => props.onPick(null)}>Kein Datum</Button>}
      </div>
    </Sheet>
  );
}
