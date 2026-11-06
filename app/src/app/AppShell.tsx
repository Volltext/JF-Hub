import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { LogOut, Server } from 'lucide-react';
import { useAccount } from '@/core/account/account';
import { IS_DEMO, IS_WEB } from '@/core/env';
import { confirmAndLogout } from '@/features/account/AccountCards';
import { GROUP_LABEL, featureGroups, features, routePath } from './features';
import { NavShell, type NavEntry } from './NavShell';

const toEntry = (f: (typeof features)[number]) => ({ id: f.id, label: f.label, icon: f.icon, to: routePath(f) });

const bottom = features
  .filter((f) => f.nav)
  .sort((a, b) => a.nav!.order - b.nav!.order)
  .map((f) => ({ ...toEntry(f), label: f.nav!.label ?? f.label }));

const sections = featureGroups().map(({ group, items }) => ({ label: GROUP_LABEL[group], items: items.map(toEntry) }));

/** Titel im Browser-Tab je Bereich („Dienste · JF Hub“): hilft beim Wechseln zwischen Tabs und Screenreadern beim Seitenwechsel. */
function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const f = features.find((x) => (routePath(x) === '/' ? pathname === '/' : pathname.startsWith(routePath(x))));
    document.title = f && f.id !== 'home' ? `${f.label} · JF Hub` : 'JF Hub';
  }, [pathname]);
}

export function AppShell() {
  useDocumentTitle();
  const account = useAccount();
  // Im Browser gibt es keine Android-App-Hülle: Abmelden und (für Admins) die Server-Verwaltung stehen unten in der Seitenleiste.
  // Die Browser-Demo hat weder Konto noch Server.
  const footer: NavEntry[] = IS_WEB && !IS_DEMO
    ? [
        ...(account?.role === 'admin' ? [{ id: 'admin', href: '/admin/', label: 'Server-Verwaltung', icon: Server }] : []),
        { id: 'logout', onClick: () => void confirmAndLogout().then((done) => done && window.location.reload()), label: 'Abmelden', icon: LogOut },
      ]
    : [];
  return (
    <NavShell bottom={bottom} moreId="mehr" sections={sections} footer={footer}>
      <Routes>
        {features.map((f) => (
          <Route key={f.id} path={f.path} element={f.element} />
        ))}
      </Routes>
    </NavShell>
  );
}
