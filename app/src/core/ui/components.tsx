import { useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, X, type LucideIcon } from 'lucide-react';
import { useFocusTrap, useOverlayClose } from './overlay';
import { confirmDialog } from './dialog';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Page(props: {
  title: string;
  sub?: string;
  /** Übergeordnete Seite: zeigt oben einen Zurück-Link. */
  back?: { to: string; label: string };
  /** Seite liegt unter „Mehr“: auf schmalen Bildschirmen führt ein Zurück-Link dorthin (die Seitenleiste zeigt den Pfad schon). */
  fromMore?: boolean;
  /** Schaltflächen rechts neben dem Titel. */
  actions?: ReactNode;
  /** Wichtigste Neu-Aktion der Seite: am Handy runder Knopf unten rechts, am Laptop beschrifteter Knopf im Kopf. */
  create?: { label: string; onClick: () => void };
  children?: ReactNode;
}) {
  const { create, title, sub, back, fromMore, actions, children } = props;
  return (
    <div className="page">
      {(back || fromMore) && (
        <Link to={(back ?? { to: '/mehr' }).to} className={`back-link${back ? '' : ' back-link--narrow'}`}>
          <ChevronLeft size={18} />
          {back ? back.label : 'Mehr'}
        </Link>
      )}
      <header className="page__head">
        <div className="page__headtext">
          <h1 className="page__title">{title}</h1>
          {sub && <p className="page__sub">{sub}</p>}
        </div>
        {(actions || create) && (
          <div className="page__actions">
            {actions}
            {create && (
              <button type="button" className="btn btn--primary page-cta" onClick={create.onClick}>
                <Plus size={18} /> {create.label}
              </button>
            )}
          </div>
        )}
      </header>
      {children}
      {create && (
        <button type="button" className="fab fab--page" aria-label={create.label} onClick={create.onClick}>
          <Plus />
        </button>
      )}
    </div>
  );
}

/** Beschriftete Gruppe von Menüzeilen (Mehr-Seite, Einstellungen). */
export function MenuGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="menu-group">
      {label && <h2 className="group-label">{label}</h2>}
      <div className="menu-list">{children}</div>
    </section>
  );
}

/** Große Zeile mit Symbol, Titel, Kurzbeschreibung und Pfeil – führt auf eine Unterseite oder zu einer Adresse. */
export function MenuRow({
  to,
  href,
  icon: Icon,
  title,
  sub,
  badge,
  onClick,
}: {
  to?: string;
  href?: string;
  icon: LucideIcon;
  title: string;
  sub?: string;
  /** Zähler rechts (z. B. offene Aufgaben); `tone="alert"` hebt Dringendes hervor. */
  badge?: { text: string; tone?: 'alert' };
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="menu-row__icon">
        <Icon size={20} />
      </span>
      <span className="menu-row__text">
        <span className="menu-row__head">
          <span className="menu-row__title">{title}</span>
          {badge && <span className={`menu-row__badge${badge.tone === 'alert' ? ' menu-row__badge--alert' : ''}`}>{badge.text}</span>}
        </span>
        {sub && <span className="menu-row__sub">{sub}</span>}
      </span>
      <ChevronRight size={18} className="menu-row__chev" />
    </>
  );
  if (to) return <Link to={to} className="menu-row">{body}</Link>;
  if (href) return <a href={href} className="menu-row" target="_blank" rel="noopener">{body}</a>;
  return <button type="button" className="menu-row" onClick={onClick}>{body}</button>;
}

/** Hinweis, wenn eine Liste leer ist – mit klarer nächster Aktion. */
export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; /** Nächster Schritt als Schaltfläche. */ action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon size={28} />
      </span>
      <strong>{title}</strong>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Card({ title, link, children }: { title?: string; /** Rechts im Kopf: führt zur vollständigen Ansicht. */ link?: { to: string; label: string }; children: ReactNode }) {
  return (
    <section className="card">
      {(title || link) && (
        <div className="card__head">
          {title && <h2 className="card__title">{title}</h2>}
          {link && (
            <Link to={link.to} className="card__link">
              {link.label}
            </Link>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'danger';
  block?: boolean;
};

export function Button({ variant, block, className = '', ...rest }: BtnProps) {
  const cls = ['btn', variant && `btn--${variant}`, block && 'btn--block', className].filter(Boolean).join(' ');
  return <button className={cls} {...rest} />;
}

/**
 * Einfachauswahl aus zwei bis vier gleichwertigen Möglichkeiten (Ansicht, Filter, Wert). Mit `tabs` als Reiter für die Bereiche einer Seite.
 * Mehr als vier Möglichkeiten oder Mehrfachauswahl: Chips (`.chip-btn`). Regeln: docs/entwicklung.md, „Oberfläche und Design-Tokens“.
 */
export function Segmented<T extends string>(props: {
  disabled?: boolean;
  /** Flache Bauform für Kopfzeilen mit mehreren Schaltern. */
  compact?: boolean;
  /** Reiter mit Unterstrich statt Schalterleiste: für die Gliederung einer Seite in Bereiche. */
  tabs?: boolean;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className={`segmented${props.compact ? ' segmented--compact' : ''}${props.tabs ? ' segmented--tabs' : ''}`} role="group">
      {props.options.map((o) => (
        // type="button": Sonst schickt ein Segmented in einem Formular es beim Antippen ab.
        <button key={o.value} type="button" disabled={props.disabled} aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  footer,
  dirty,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Bleibt unten sichtbar (Speichern, Löschen), auch wenn der Inhalt scrollt. */
  footer?: ReactNode;
  /** Ungespeicherte Änderungen: vor dem Schließen nachfragen. */
  dirty?: boolean;
  /** Breiter auf Laptop/Tablet (lange Listen in zwei Spalten). */
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const requestClose = async () => {
    if (dirtyRef.current && !(await confirmDialog('Deine Änderungen sind noch nicht gespeichert.', { title: 'Änderungen verwerfen?', confirmLabel: 'Verwerfen', cancelLabel: 'Weiter bearbeiten', danger: true }))) return;
    onClose();
  };
  useOverlayClose(() => void requestClose());
  useFocusTrap(box);

  return (
    <div className="sheet-backdrop" onClick={() => void requestClose()}>
      <div
        ref={box}
        tabIndex={-1}
        className={`sheet${footer ? ' sheet--has-footer' : ''}${wide ? ' sheet--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__head">
          <h2 className="sheet__title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="btn sheet__close" onClick={() => void requestClose()} aria-label="Schließen">
            <X size={20} />
          </button>
        </div>
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__footer">{footer}</div>}
      </div>
    </div>
  );
}
