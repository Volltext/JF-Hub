import { useEffect, useState, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bell, Database, Server, SlidersHorizontal, Timer } from 'lucide-react';
import { Button, Card, MenuGroup, MenuRow, Page, Segmented } from '@/core/ui/components';
import { applyTheme } from '@/core/ui/theme';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '@/core/settings/settings';
import { pin } from '@/core/settings/pin';
import { exportBackup, importBackup } from '@/core/db/backup';
import { pickTextFile, shareTextFile } from '@/core/native/files';
import { ensureNotificationPermission } from '@/core/native/notifications';
import { TimeField } from '@/core/ui/pickers';
import { WASSERENTNAHME_LABEL, type Wasserentnahme } from '@/features/wettkampf/rules/bwScoring';
import { loadWasserentnahme, saveWasserentnahme } from '@/features/wettkampf/store';
import { confirmDialog } from '@/core/ui/dialog';
import { ConnectionCard, DevicesCard, PasswordCard } from '@/features/account/AccountCards';
import { useAccount } from '@/core/account/account';
import { IS_DEMO, IS_WEB } from '@/core/env';
import { PushCard } from './PushCard';
import { ServiceCard } from './ServiceCard';
import { markAllForSync } from '@/core/db/outbox';

const BACK = { to: '/einstellungen', label: 'Einstellungen' };

/** Einstellungen: eine Übersicht mit Themen, jedes Thema auf einer eigenen Seite. */
export function SettingsPage() {
  return (
    <Routes>
      <Route index element={<Overview />} />
      <Route path="allgemein" element={<General />} />
      <Route path="erinnerungen" element={<Reminders />} />
      <Route path="wettkampf" element={<Competition />} />
      <Route path="server" element={<Servers />} />
      <Route path="daten" element={<Data />} />
      <Route path="*" element={<Overview />} />
    </Routes>
  );
}

function Overview() {
  return (
    <Page title="Einstellungen">
      <MenuGroup>
        <MenuRow to="/einstellungen/allgemein" icon={SlidersHorizontal} title={IS_WEB ? 'Darstellung & neue Einträge' : 'Darstellung & Sicherheit'} sub={IS_WEB ? 'Hell/Dunkel, wer neue Einträge sieht' : 'Hell/Dunkel, PIN-Sperre, wer neue Einträge sieht'} />
        <MenuRow to="/einstellungen/erinnerungen" icon={Bell} title="Erinnerungen" sub="Dienst-Erinnerung, fällige Aufgaben" />
        <MenuRow to="/einstellungen/wettkampf" icon={Timer} title="Wettkampf" sub="Wasserentnahme im A-Teil" />
        <MenuRow to="/einstellungen/server" icon={Server} title={IS_WEB ? 'Konto' : 'Server & Konto'} sub="Anmeldung, Passwort, Geräte" />
        <MenuRow to="/einstellungen/daten" icon={Database} title="Daten & Backup" sub="Sicherung dieses Geräts, Export" />
      </MenuGroup>
    </Page>
  );
}

/** Gemeinsamer Zustand der Unterseiten: Einstellungen laden/speichern und Rückmeldung anzeigen. */
function useSettingsPage() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void loadSettings().then(setS);
  }, []);

  async function patch(p: Partial<Settings>) {
    const next = await saveSettings(p);
    setS(next);
    if (p.theme) applyTheme(next.theme);
  }
  async function run(fn: () => Promise<string | void>) {
    try {
      setMsg((await fn()) ?? '');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Fehler');
    }
  }
  return { s, setS, patch, run, msg };
}

function Status({ msg }: { msg: string }): ReactNode {
  return msg ? (
    <p role="status" className="muted">
      {msg}
    </p>
  ) : null;
}

function General() {
  const { s, patch, run, msg } = useSettingsPage();
  const [pinSet, setPinSet] = useState(false);
  const [newPin, setNewPin] = useState('');
  useEffect(() => {
    void pin.isSet().then(setPinSet);
  }, []);

  return (
    <Page title={IS_WEB ? 'Darstellung & neue Einträge' : 'Darstellung & Sicherheit'} back={BACK}>
      <Card title="Darstellung">
        <Segmented
          value={s.theme}
          onChange={(theme) => patch({ theme })}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'dark', label: 'Dunkel' },
            { value: 'light', label: 'Hell' },
          ]}
        />
      </Card>

      <Card title="Neue Protokolle und Aufgaben">
        <div className="stack">
          <Segmented<'private' | 'shared'>
            value={s.defaultShared ? 'shared' : 'private'}
            onChange={(v) => patch({ defaultShared: v === 'shared' })}
            options={[
              { value: 'private', label: 'Zuerst privat' },
              { value: 'shared', label: 'Für alle sichtbar' },
            ]}
          />
          <p className="muted">
            {s.defaultShared
              ? 'Neue Einträge sehen gleich alle Betreuer. Im Eintrag selbst lässt sich das jederzeit ändern.'
              : 'Neue Einträge sieht nur du. Mit „Veröffentlichen“ im Eintrag sehen sie auch die anderen Betreuer.'}
          </p>
        </div>
      </Card>

      {!IS_WEB && (
      <Card title="PIN-Sperre">
        <div className="stack">
          <p className="muted">{pinSet ? 'Die App ist mit einer PIN geschützt und sperrt sich im Hintergrund.' : 'Keine PIN gesetzt.'}</p>
          <label className="field">
            <span>{pinSet ? 'Neue PIN (4–6 Ziffern)' : 'PIN festlegen (4–6 Ziffern)'}</span>
            <input inputMode="numeric" type="password" maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} />
          </label>
          <Button
            variant="primary"
            onClick={() =>
              run(async () => {
                await pin.set(newPin);
                setNewPin('');
                setPinSet(true);
                return 'PIN gespeichert.';
              })
            }
          >
            PIN speichern
          </Button>
          {pinSet && (
            <Button
              variant="danger"
              onClick={() =>
                run(async () => {
                  await pin.clear();
                  setPinSet(false);
                  return 'PIN entfernt.';
                })
              }
            >
              PIN entfernen
            </Button>
          )}
          <Status msg={msg} />
        </div>
      </Card>
      )}
    </Page>
  );
}

function Reminders() {
  const { s, patch, run, msg } = useSettingsPage();
  return (
    <Page title="Erinnerungen" back={BACK}>
      <PushCard />
      <ServiceCard />

      <Card title="Aufgaben-Erinnerungen">
        <div className="stack">
          <button
            className="toggle"
            aria-pressed={s.notificationsEnabled}
            onClick={() =>
              run(async () => {
                const enabled = !s.notificationsEnabled;
                await patch({ notificationsEnabled: enabled });
                if (enabled && !(await ensureNotificationPermission()))
                  return IS_WEB ? 'Benachrichtigungen sind für dieses Gerät nicht eingeschaltet (siehe oben).' : 'Benachrichtigungen sind in den Android-Einstellungen nicht erlaubt.';
              })
            }
          >
            <span className="toggle__box">{s.notificationsEnabled && '✓'}</span> Am Fälligkeitstag erinnern
          </button>
          <TimeField label="Uhrzeit am Fälligkeitstag" value={s.taskNotifyTime} onChange={(v) => patch({ taskNotifyTime: v })} />
          <Status msg={msg} />
        </div>
      </Card>
    </Page>
  );
}

function Competition() {
  const wasserentnahme = useLiveQuery(loadWasserentnahme, []);
  return (
    <Page title="Wettkampf" back={BACK}>
      <Card title="Wasserentnahme im A-Teil">
        <div className="stack">
          <Segmented<Wasserentnahme>
            value={wasserentnahme ?? 'saug'}
            onChange={(v) => void saveWasserentnahme(v)}
            options={(['saug', 'hydrant'] as const).map((v) => ({ value: v, label: WASSERENTNAHME_LABEL[v] }))}
          />
          <p className="muted">
            {(wasserentnahme ?? 'saug') === 'hydrant'
              ? 'Unterflurhydrant: Zwischenzeit „Wasser marsch“, Fehlerkatalog ohne Saugleitung. Gilt für neue Läufe.'
              : 'Offenes Gewässer: Zwischenzeit „zu Wasser“, Fehlerkatalog mit Saugleitung. Gilt für neue Läufe.'}
          </p>
        </div>
      </Card>
      <Card title="Hinweis zu Regeln und Wertung">
        <p className="muted">
          Fehlerkatalog, Wertungstabellen und Wissensinhalte sind eine inoffizielle Hilfe ohne Gewähr und kein Produkt der Deutschen Jugendfeuerwehr. Punktwerte, die im
          Fehlerkatalog als „ungeprüft“ markiert sind, stammen nicht aus einem offiziellen Wertungsbogen. Vor einem Wettkampf bitte mit den aktuellen Unterlagen abgleichen.
        </p>
      </Card>
    </Page>
  );
}

function Servers() {
  const account = useAccount();
  if (IS_DEMO) return <DemoAccount />;
  return (
    <Page title={IS_WEB ? 'Konto' : 'Server & Konto'} back={BACK}>
      <ConnectionCard />
      {account && <PasswordCard />}
      {account && <DevicesCard />}
    </Page>
  );
}

/** Browser-Demo: kein Server, kein Konto – stattdessen der Weg zur eigenen Installation. */
function DemoAccount() {
  return (
    <Page title="Konto" back={BACK}>
      <Card title="Demo im Browser">
        <div className="stack">
          <p className="muted">
            Hier bist du Jana Becker, die Jugendwartin der erfundenen Jugendfeuerwehr Musterstadt. Alles, was du änderst, bleibt nur in diesem Browser.
          </p>
          <p className="muted">
            In der eigenen Installation hat jeder Betreuer ein Konto, alle Geräte gleichen sich über euren Server ab, und der Server erzeugt PDFs und
            Benachrichtigungen.
          </p>
          <a className="btn btn--primary" href="https://github.com/Volltext/JF-Hub/blob/main/docs/installation.md" target="_blank" rel="noopener">
            So richtest du JF Hub ein
          </a>
        </div>
      </Card>
    </Page>
  );
}

function Data() {
  const { setS, run, msg } = useSettingsPage();
  return (
    <Page title="Daten & Backup" back={BACK}>
      <Card title="Backup">
        <div className="stack">
          <p className="muted">Die Sicherung enthält alle Daten dieses Geräts als Datei. Fotos und Dateien von Protokollen sind dabei, soweit sie noch nicht auf dem Server liegen; was der Server hat, holt die App von dort.</p>
          <Button
            onClick={() =>
              run(async () => {
                const b = await exportBackup();
                await shareTextFile(`jf-hub-${b.exportedAt.slice(0, 10)}.json`, JSON.stringify(b));
                return 'Sicherung erstellt.';
              })
            }
          >
            Sicherung exportieren
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              run(async () => {
                if (!(await confirmDialog('Alle aktuellen Daten werden durch die Sicherung ersetzt. Fortfahren?', { danger: true, confirmLabel: 'Ersetzen' }))) return;
                const text = await pickTextFile();
                if (!text) return;
                await importBackup(JSON.parse(text));
                await markAllForSync();
                setS(await loadSettings());
                return 'Sicherung wiederhergestellt.';
              })
            }
          >
            Sicherung wiederherstellen
          </Button>
          <Status msg={msg} />
        </div>
      </Card>
    </Page>
  );
}
