import { Capacitor } from '@capacitor/core';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { IS_DEMO } from '@/core/env';
import { Button, Card, Page } from '@/core/ui/components';
import { APP_VERSION, apkUrl, RELEASES_URL } from './release';
import { checkServerVersion, useAppUpdate } from './useAppUpdate';
import './appVersion.css';

const BACK = { to: '/einstellungen', label: 'Einstellungen' };

/** So wird eine heruntergeladene APK installiert (gilt für Erstinstallation und Update). */
function InstallSteps({ update }: { update?: boolean }) {
  return (
    <ol className="app-steps">
      <li>Auf dem Android-Gerät herunterladen und die Datei öffnen (Benachrichtigung „Download abgeschlossen“ oder Ordner „Downloads“).</li>
      <li>Android fragt einmalig, ob der Browser bzw. Dateimanager Apps installieren darf: erlauben.</li>
      {update ? (
        <li>„Aktualisieren“ antippen. Die App bleibt angemeldet, deine Daten bleiben erhalten.</li>
      ) : (
        <li>
          App öffnen, unter <em>Einstellungen › Server &amp; Konto</em> die Adresse dieses Servers eintragen und anmelden (oder eine Einladung einlösen).
        </li>
      )}
    </ol>
  );
}

/**
 * Einstellungen › App & Version. In der Android-App: installierte Version, Version des Servers und, wenn er neuer ist, der Download
 * der passenden APK. Im Browser (PWA): der Download der Android-App zur Version dieses Servers.
 */
export function AppVersionPage() {
  const native = Capacitor.isNativePlatform();
  const update = useAppUpdate();
  const [checking, setChecking] = useState(false);

  return (
    <Page title="App & Version" back={BACK}>
      <Card title="Version">
        <dl className="app-versions">
          <div>
            <dt>{native ? 'Android-App' : 'Diese App'}</dt>
            <dd>{APP_VERSION}</dd>
          </div>
          {native && (
            <div>
              <dt>Server</dt>
              <dd>{update.server ?? 'noch nicht bekannt'}</dd>
            </div>
          )}
        </dl>
        {native && (
          <div className="stack app-status">
            {update.available ? (
              <p className="app-status__new" role="status">
                Version {update.available} ist da. Installiere sie über die bisherige App, damit sie zum Server passt.
              </p>
            ) : (
              <p className="muted" role="status">
                {update.server ? 'Die App ist auf dem Stand des Servers.' : 'Die Version des Servers wird abgefragt, sobald eine Verbindung besteht.'}
              </p>
            )}
            {!update.available && (
              <Button
                className="btn--icon"
                disabled={checking}
                onClick={() => {
                  setChecking(true);
                  void checkServerVersion(true).finally(() => setChecking(false));
                }}
              >
                <RefreshCw size={18} className={checking ? 'spin' : undefined} /> Jetzt prüfen
              </Button>
            )}
          </div>
        )}
      </Card>

      {native && update.available && (
        <Card title="Update installieren">
          <div className="stack">
            <a className="btn btn--primary btn--icon" href={apkUrl(update.available)} target="_blank" rel="noopener">
              <Download size={18} /> Version {update.available} herunterladen
            </a>
            <InstallSteps update />
          </div>
        </Card>
      )}

      {!native && (
        <Card title="Android-App">
          <div className="stack">
            <p>
              Zusätzlich zur App im Browser gibt es eine Android-App mit <strong>Stift-Handschrift</strong> (Stiftdruck, Handballen-Erkennung, Handschrift → Text),
              <strong> PIN-Sperre</strong> und <strong>Erinnerungen direkt vom Gerät</strong>. Die Daten sind dieselben, sie kommen vom Server.
            </p>
            {IS_DEMO ? (
              <a className="btn btn--primary btn--icon" href={`${RELEASES_URL}/latest`} target="_blank" rel="noopener">
                <Download size={18} /> Neueste Android-App
              </a>
            ) : (
              <a className="btn btn--primary btn--icon" href={apkUrl(APP_VERSION)} target="_blank" rel="noopener">
                <Download size={18} /> APK herunterladen (Version {APP_VERSION})
              </a>
            )}
            <InstallSteps />
            <p className="muted app-note">
              {IS_DEMO
                ? 'Die App gehört zu einem eigenen JF-Hub-Server; die Demo im Browser hat keinen.'
                : 'Die APK passt genau zur Version dieses Servers. Gibt es den Download noch nicht (Server-Version noch nicht veröffentlicht), nimm die neueste unter „Alle Versionen“.'}{' '}
              Neue Versionen meldet die Android-App selbst. Sie ist nicht im Play Store.
            </p>
            <a className="app-link" href={RELEASES_URL} target="_blank" rel="noopener">
              Alle Versionen <ExternalLink size={14} />
            </a>
          </div>
        </Card>
      )}
    </Page>
  );
}

/** Hinweis auf „Heute“ in der Android-App, wenn eine neuere Version da ist. „Später“ blendet ihn bis zur nächsten Version aus. */
export function UpdateCard() {
  const update = useAppUpdate();
  if (!update.available || update.dismissed) return null;
  return (
    <section className="card card--accent" aria-labelledby="update-title">
      <h2 id="update-title" className="onboard__title">
        Neue App-Version {update.available}
      </h2>
      <p className="muted app-note">Installiert ist {APP_VERSION}. Die neue Version installierst du über die bisherige, deine Daten bleiben.</p>
      <div className="app-actions">
        <a className="btn btn--primary btn--icon" href={apkUrl(update.available)} target="_blank" rel="noopener">
          <Download size={18} /> Herunterladen
        </a>
        <Button onClick={update.dismiss}>Später</Button>
      </div>
    </section>
  );
}
