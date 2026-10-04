import { MenuGroup, MenuRow, Page } from '@/core/ui/components';
import { GROUP_LABEL, featureGroups, routePath } from '@/app/features';

/** Alles, was nicht in der unteren Leiste steht – nach Themen gegliedert. */
export function MorePage() {
  const groups = featureGroups()
    .map((g) => ({ ...g, items: g.items.filter((f) => !f.nav) }))
    .filter((g) => g.items.length);

  return (
    <Page title="Mehr">
      {groups.map(({ group, items }) => (
        <MenuGroup key={group} label={GROUP_LABEL[group]}>
          {items.map((f) => (
            <MenuRow key={f.id} to={routePath(f)} icon={f.icon} title={f.label} sub={f.description} />
          ))}
        </MenuGroup>
      ))}
      <p className="muted more__version">JF Hub {__APP_VERSION__} · freie Software (AGPL-3.0) · inoffiziell, kein Produkt der Deutschen Jugendfeuerwehr</p>
    </Page>
  );
}
