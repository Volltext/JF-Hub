import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { type LucideIcon } from 'lucide-react';

export interface NavEntry {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Interne Route. */
  to?: string;
  /** Externe Adresse (öffnet in neuem Tab). */
  href?: string;
  onClick?: () => void;
}

export interface NavSection {
  label?: string;
  items: NavEntry[];
}

/** Ist `to` der Wurzelpfad, soll er nur bei exakter Übereinstimmung aktiv sein. */
const isRoot = (to: string) => to === '/';

/**
 * Gemeinsames Gerüst für App und Web-Client:
 * schmal = untere Leiste mit den wichtigsten Bereichen, breit = Seitenleiste mit allen Bereichen nach Themen.
 */
export function NavShell({
  bottom,
  moreId,
  sections,
  footer = [],
  children,
}: {
  bottom: NavEntry[];
  /** Eintrag der unteren Leiste, der auch bei allen nicht dort gelisteten Seiten hervorgehoben wird. */
  moreId: string;
  sections: NavSection[];
  footer?: NavEntry[];
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const inBottom = bottom.some((e) => e.id !== moreId && e.to && (isRoot(e.to) ? pathname === '/' : pathname.startsWith(e.to)));

  return (
    <div className="shell">
      <aside className="side" aria-label="Navigation">
        <div className="side__brand">
          <img className="side__logo" src="/favicon.svg" alt="" />
          JF Hub
        </div>
        <nav className="side__nav" aria-label="Bereiche">
          {sections.map((s, i) => (
            <div key={s.label ?? i} className="side__section">
              {s.label && <div className="side__label">{s.label}</div>}
              {s.items.map((e) => (
                <SideItem key={e.id} entry={e} />
              ))}
            </div>
          ))}
        </nav>
        {footer.length > 0 && (
          <div className="side__footer">
            {footer.map((e) => (
              <SideItem key={e.id} entry={e} />
            ))}
          </div>
        )}
      </aside>

      <main className="shell__main">{children}</main>

      <nav className="nav" aria-label="Hauptnavigation">
        {bottom.map(({ id, to, label, icon: Icon }) => (
          <NavLink
            key={id}
            to={to!}
            end={isRoot(to!)}
            className={({ isActive }) => `nav__item${isActive || (id === moreId && !inBottom) ? ' is-active' : ''}`}
          >
            <span className="nav__pill">
              <Icon size={22} />
            </span>
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function SideItem({ entry: { to, href, onClick, label, icon: Icon } }: { entry: NavEntry }) {
  const inner = (
    <>
      <Icon size={19} />
      <span>{label}</span>
    </>
  );
  if (to) return <NavLink to={to} end={isRoot(to)} className="side__item">{inner}</NavLink>;
  if (href) return <a href={href} className="side__item" target="_blank" rel="noopener">{inner}</a>;
  return <button type="button" className="side__item" onClick={onClick}>{inner}</button>;
}
