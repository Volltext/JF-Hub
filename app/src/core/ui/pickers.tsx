import { createContext, useContext, useId, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Keyboard } from 'lucide-react';
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
/** Verbindet den sichtbaren Feldnamen mit dem Auswahlknopf: Screenreader lesen „Beginn, 18:00 Uhr“ statt nur „18:00 Uhr“. */
const FieldLabel = createContext<string | undefined>(undefined);

function Shell({ label, children }: FieldShellProps) {
  const id = useId();
  return (
    <div className="field">
      <span id={id}>{label}</span>
      <FieldLabel.Provider value={id}>{children}</FieldLabel.Provider>
    </div>
  );
}

function PickerButton(props: { text: string; placeholder?: boolean; disabled?: boolean; onClick: () => void }) {
  const labelId = useContext(FieldLabel);
  const valueId = useId();
  return (
    <button type="button" className="picker-btn" disabled={props.disabled} onClick={props.onClick} aria-haspopup="dialog" aria-labelledby={labelId ? `${labelId} ${valueId}` : undefined}>
      <span id={valueId} style={props.placeholder ? { color: 'var(--muted)' } : undefined}>{props.text}</span>
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

/** Ein Vorschlag als Schnellwahl im Zeitfenster, etwa „Dienstbeginn“ oder „+1½ Std.“. */
export interface TimeSuggestion {
  label: string;
  value: string;
}

/**
 * Uhrzeit wählen. Oben steht groß die Zeit; darunter erst die Stunden, nach dem Antippen die Minuten. „Übernehmen“ schließt.
 * Häufige Zeiten (Jetzt, Vorschläge des Aufrufers) gibt es als Schnellwahl mit einem Tipp. Getippt werden kann auch („1730“).
 */
export function TimeField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** Schnellwahl zusätzlich zu „Jetzt“. */
  suggestions?: TimeSuggestion[];
  /** Erlaubt „Keine Uhrzeit“ (setzt den Wert auf leer). */
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Shell label={props.label}>
      <PickerButton
        text={props.value ? `${props.value} Uhr` : 'Uhrzeit'}
        placeholder={!props.value}
        disabled={props.disabled}
        onClick={() => setOpen(true)}
      />
      {open && (
        <TimeSheet
          title={props.label}
          value={props.value}
          suggestions={props.suggestions}
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

function TimeSheet(props: {
  title: string;
  value: string;
  suggestions?: TimeSuggestion[];
  clearable?: boolean;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const initial = props.value ? parseTime(props.value) : parseTypedTime(nowTime())!;
  const fine = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
  const [t, setT] = useState(initial);
  const [step, setStep] = useState<'h' | 'm'>('h');
  // Am Rechner gleich tippen; am Handy erst auf Wunsch (sonst verdeckt die Tastatur die Auswahl).
  const [typing, setTyping] = useState(fine);
  const [text, setText] = useState(formatTime(initial.h, initial.min));
  const hintId = useId();
  const now = nowTime();
  const chosen = formatTime(t.h, t.min);

  // Schnellwahl: „Jetzt“ und die Vorschläge, ohne doppelte Zeiten.
  const quick: TimeSuggestion[] = [];
  for (const s of [{ label: 'Jetzt', value: now }, ...(props.suggestions ?? [])]) {
    if (!quick.some((q) => q.value === s.value)) quick.push(s);
  }

  const startTyping = () => {
    setText(chosen);
    setTyping(true);
  };

  return (
    <Sheet title={props.title} onClose={props.onClose}>
      <form
        className="tp"
        onSubmit={(e) => {
          e.preventDefault();
          props.onPick(chosen);
        }}
      >
        <div className="tp-head">
          {typing ? (
            <input
              className="tp-input"
              inputMode="numeric"
              aria-label="Uhrzeit eintippen"
              aria-describedby={hintId}
              value={text}
              autoFocus
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                setText(e.target.value);
                const p = parseTypedTime(e.target.value);
                if (p) setT(p);
              }}
            />
          ) : (
            <div className="tp-time" role="group" aria-label={`Gewählt: ${chosen} Uhr`}>
              <button type="button" className="tp-seg" aria-pressed={step === 'h'} aria-label={`Stunde ${two(t.h)} ändern`} onClick={() => setStep('h')}>
                {two(t.h)}
              </button>
              <span className="tp-colon" aria-hidden>
                :
              </span>
              <button type="button" className="tp-seg" aria-pressed={step === 'm'} aria-label={`Minute ${two(t.min)} ändern`} onClick={() => setStep('m')}>
                {two(t.min)}
              </button>
            </div>
          )}
          <button
            type="button"
            className="tp-mode"
            aria-pressed={typing}
            onClick={() => (typing ? setTyping(false) : startTyping())}
          >
            {typing ? <Clock size={18} /> : <Keyboard size={18} />}
            {typing ? 'Auswählen' : 'Eintippen'}
          </button>
        </div>

        {typing ? (
          <p id={hintId} className="tp-hint">
            z. B. „1730“, „17:30“ oder „9“
          </p>
        ) : (
          <>
            <div className="tp-steps" role="tablist" aria-label="Was wählen">
              <button type="button" role="tab" aria-selected={step === 'h'} className="tp-step" onClick={() => setStep('h')}>
                1 · Stunde
              </button>
              <button type="button" role="tab" aria-selected={step === 'm'} className="tp-step" onClick={() => setStep('m')}>
                2 · Minute
              </button>
            </div>
            {step === 'h' ? (
              <div className="tp-pad tp-pad--hours" role="tabpanel" aria-label="Stunde">
                {HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className="tp-key"
                    aria-pressed={h === t.h}
                    onClick={() => {
                      setT({ h, min: t.min });
                      setStep('m');
                    }}
                  >
                    {two(h)}
                  </button>
                ))}
              </div>
            ) : (
              <div className="tp-pad tp-pad--minutes" role="tabpanel" aria-label="Minute">
                {MINUTES.map((min) => (
                  <button key={min} type="button" className="tp-key" aria-pressed={min === t.min} onClick={() => setT({ h: t.h, min })}>
                    :{two(min)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <div className="tp-quick" aria-label="Schnellwahl">
          {quick.map((q) => (
            <button key={q.value} type="button" className="tp-chip" onClick={() => props.onPick(q.value)}>
              <span>{q.label}</span>
              <strong>{q.value}</strong>
            </button>
          ))}
        </div>

        <div className="tp-actions">
          {props.clearable && props.value && (
            <Button type="button" onClick={() => props.onPick('')}>
              Keine Uhrzeit
            </Button>
          )}
          <Button variant="primary" type="submit" aria-label={`${chosen} Uhr übernehmen`}>
            Übernehmen
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
