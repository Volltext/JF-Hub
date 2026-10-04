import { Route, Routes } from 'react-router-dom';
import { LogOut, Server } from 'lucide-react';
import { useAccount } from '@/core/account/account';
import { IS_WEB } from '@/core/env';
import { confirmAndLogout } from '@/features/account/AccountCards';
import { GROUP_LABEL, featureGroups, features, routePath } from './features';
import { NavShell, type NavEntry } from './NavShell';

const toEntry = (f: (typeof features)[number]) => ({ id: f.id, label: f.label, icon: f.icon, to: routePath(f) });

const bottom = features
  .filter((f) => f.nav)
  .sort((a, b) => a.nav!.order - b.nav!.order)
  .map(toEntry);

const sections = featureGroups().map(({ group, items }) => ({ label: GROUP_LABEL[group], items: items.map(toEntry) }));

export function AppShell() {
  const account = useAccount();
  // Im Browser gibt es keine Android-App-Hülle: Abmelden und (für Admins) die Server-Verwaltung stehen unten in der Seitenleiste.
  const footer: NavEntry[] = IS_WEB
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
