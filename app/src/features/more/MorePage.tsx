import { MenuGroup, MenuRow, Page } from '@/core/ui/components';
import { GROUP_LABEL, featureGroups, routePath } from '@/app/features';
import { useAttention, type Attention } from '@/features/home/useAttention';

/** Zähler zu einem Bereich: Dringendes (überfällige Aufgaben) in Rot, sonst der Bestand. */
function badgeFor(id: string, a: Attention): { text: string; tone?: 'alert' } | undefined {
  if (id === 'aufgaben') {
    if (a.overdueTasks > 0) return { text: `${a.overdueTasks} überfällig`, tone: 'alert' };
    return a.openTasks > 0 ? { text: `${a.openTasks} offen` } : undefined;
  }
  if (id === 'kleidung') return a.clothing > 0 ? { text: `${a.clothing} zu beschaffen` } : undefined;
  if (id === 'mitglieder') return a.members > 0 ? { text: `${a.members} aktiv` } : undefined;
  return undefined;
}

/** Alles, was nicht in der unteren Leiste steht – nach Themen gegliedert, mit Zählern, damit man sieht, wo etwas ansteht. */
export function MorePage() {
  const attention = useAttention();
  const groups = featureGroups()
    .map((g) => ({ ...g, items: g.items.filter((f) => !f.nav) }))
    .filter((g) => g.items.length);

  return (
    <Page title="Mehr">
      {groups.map(({ group, items }) => (
        <MenuGroup key={group} label={GROUP_LABEL[group]}>
          {items.map((f) => (
            <MenuRow key={f.id} to={routePath(f)} icon={f.icon} title={f.label} sub={f.description} badge={badgeFor(f.id, attention)} />
          ))}
        </MenuGroup>
      ))}
      <p className="muted more__version">JF Hub {__APP_VERSION__} · freie Software (AGPL-3.0) · inoffiziell, kein Produkt der Deutschen Jugendfeuerwehr</p>
    </Page>
  );
}
