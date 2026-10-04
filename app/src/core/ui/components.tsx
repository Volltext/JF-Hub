import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { useOverlayClose } from './overlay';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Page({
  title,
  sub,
  back,
  actions,
  children,
}: {
  title: string;
  sub?: string;
  /** Übergeordnete Seite: zeigt oben einen Zurück-Link. */
  back?: { to: string; label: string };
  /** Schaltflächen rechts neben dem Titel. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page">
      {back && (
        <Link to={back.to} className="back-link">
          <ChevronLeft size={18} />
          {back.label}
        </Link>
      )}
      <header className="page__head">
        <div className="page__headtext">
          <h1 className="page__title">{title}</h1>
          {sub && <p className="page__sub">{sub}</p>}
        </div>
        {actions && <div className="page__actions">{actions}</div>}
      </header>
      {children}
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
  onClick,
}: {
  to?: string;
  href?: string;
  icon: LucideIcon;
  title: string;
  sub?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="menu-row__icon">
        <Icon size={20} />
      </span>
      <span className="menu-row__text">
        <span className="menu-row__title">{title}</span>
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
export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={30} />
      <strong>{title}</strong>
      {children && <p className="muted">{children}</p>}
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

export function Segmented<T extends string>(props: {
  disabled?: boolean;
  /** Flache Bauform für Kopfzeilen mit mehreren Schaltern. */
  compact?: boolean;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className={`segmented${props.compact ? ' segmented--compact' : ''}`} role="group">
      {props.options.map((o) => (
        <button key={o.value} disabled={props.disabled} aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useOverlayClose(onClose);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          <button className="btn" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
