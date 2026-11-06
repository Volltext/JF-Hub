import type { ReactElement } from 'react';
import {
  BookOpen,
  CalendarCheck,
  FileText,
  Home,
  LayoutGrid,
  ListTodo,
  Mail,
  Settings,
  Shirt,
  Timer,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { HomePage } from '@/features/home/HomePage';
import { MorePage } from '@/features/more/MorePage';
import { SettingsPage } from '@/features/einstellungen/SettingsPage';
import { DienstePage } from '@/features/dienste/DienstePage';
import { TasksPage } from '@/features/aufgaben/TasksPage';
import { WettkampfPage } from '@/features/wettkampf/WettkampfPage';
import { WissenPage } from '@/features/wissen/WissenPage';
import { MembersPage } from '@/features/mitglieder/MembersPage';
import { ProtokollePage } from '@/features/protokolle/ProtokollePage';
import { KleidungPage } from '@/features/kleidung/KleidungPage';
import { MailPage } from '@/features/mail/MailPage';

/** Thematische Gruppen: gliedern die Seitenleiste (breite Bildschirme) und die Mehr-Seite. */
export type FeatureGroup = 'start' | 'gruppe' | 'dokumentation' | 'wettkampf' | 'app';

export const GROUP_LABEL: Record<FeatureGroup, string> = {
  start: '',
  gruppe: 'Gruppe',
  dokumentation: 'Dokumentation',
  wettkampf: 'Wettkampf',
  app: 'App',
};

const GROUP_ORDER: FeatureGroup[] = ['start', 'gruppe', 'dokumentation', 'wettkampf', 'app'];

export interface Feature {
  id: string;
  path: string;
  label: string;
  icon: LucideIcon;
  group: FeatureGroup;
  /** Kurzbeschreibung (Mehr-Seite). */
  description: string;
  /**
   * Wenn gesetzt, erscheint das Feature in der unteren Leiste (schmale Bildschirme). `label` mit weichen Trennstellen (\u00AD):
   * Bei großer Schrift bricht die Beschriftung dort um, auch wo das Gerät keine deutsche Silbentrennung kennt.
   */
  nav?: { order: number; label?: string };
  element: ReactElement;
}

/**
 * Einzige Stelle, an der Features registriert werden.
 * Ein neues Modul = ein neuer Eintrag hier, der Rest der App bleibt unberührt.
 *
 * Untere Leiste: das, was bei jedem Treffen gebraucht wird (Heute, Dienste, Protokolle, Wettkampf).
 * Alles andere liegt unter „Mehr“, nach Themen gegliedert.
 */
export const features: Feature[] = [
  { id: 'home', path: '/', label: 'Heute', icon: Home, group: 'start', description: 'Überblick über den Tag', nav: { order: 1 }, element: <HomePage /> },
  {
    id: 'dienste',
    path: '/dienste',
    label: 'Dienste',
    icon: CalendarCheck,
    group: 'gruppe',
    description: 'Anwesenheit erfassen und nachsehen',
    nav: { order: 2, label: 'Diens\u00ADte' },
    element: <DienstePage />,
  },
  {
    id: 'aufgaben',
    path: '/aufgaben',
    label: 'Aufgaben',
    icon: ListTodo,
    group: 'gruppe',
    description: 'Offene Aufgaben und Erinnerungen',
    element: <TasksPage />,
  },
  {
    id: 'mitglieder',
    path: '/mitglieder',
    label: 'Mitglieder',
    icon: Users,
    group: 'gruppe',
    description: 'Jugendliche und Betreuer verwalten',
    element: <MembersPage />,
  },
  {
    id: 'kleidung',
    path: '/kleidung',
    label: 'Kleidung',
    icon: Shirt,
    group: 'gruppe',
    description: 'Kleidergrößen und was neu beschafft werden muss',
    element: <KleidungPage />,
  },
  {
    id: 'mail',
    path: '/mail/*',
    label: 'E-Mail',
    icon: Mail,
    group: 'dokumentation',
    description: 'Eigenes Postfach: Mails lesen, schreiben, Anhänge und Aufgaben übernehmen',
    element: <MailPage />,
  },
  {
    id: 'protokolle',
    path: '/protokolle/*',
    label: 'Protokolle',
    icon: FileText,
    group: 'dokumentation',
    description: 'Protokolle schreiben, abgleichen und als PDF exportieren',
    nav: { order: 3, label: 'Proto\u00ADkolle' },
    element: <ProtokollePage />,
  },
  {
    id: 'wettkampf',
    path: '/wettkampf',
    label: 'Wettkampf',
    icon: Timer,
    group: 'wettkampf',
    description: 'Aufstellung, Stoppuhr und Analyse',
    nav: { order: 4, label: 'Wett\u00ADkampf' },
    element: <WettkampfPage />,
  },
  {
    id: 'wissen',
    path: '/wissen',
    label: 'Wissen',
    icon: BookOpen,
    group: 'wettkampf',
    description: 'Regeln, Positionen und Knoten',
    element: <WissenPage />,
  },
  {
    id: 'einstellungen',
    path: '/einstellungen/*',
    label: 'Einstellungen',
    icon: Settings,
    group: 'app',
    description: 'Darstellung, Sicherheit, Server, Backup',
    element: <SettingsPage />,
  },
  {
    id: 'mehr',
    path: '/mehr',
    label: 'Mehr',
    icon: LayoutGrid,
    group: 'app',
    description: '',
    nav: { order: 5 },
    element: <MorePage />,
  },
];

/** Sichtbare Einträge nach Gruppen – „Mehr“ selbst gehört nicht in die Seitenleiste. */
export function featureGroups(): { group: FeatureGroup; items: Feature[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    items: features.filter((f) => f.group === group && f.id !== 'mehr'),
  })).filter((g) => g.items.length);
}

export const routePath = (f: Feature) => f.path.replace(/\/\*$/, '');
