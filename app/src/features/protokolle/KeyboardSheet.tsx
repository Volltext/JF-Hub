import { Sheet } from '@/core/ui/components';
import { autocorrectSetting } from './writing';

/** „Strg“ oder auf dem Mac „⌘“. */
export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Strg';
const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

/** Tastenfolge als einzelne Tasten („Strg+Umschalt+8“ → Strg, Umschalt, 8). */
function Keys({ keys }: { keys: string }) {
  return (
    <span className="kbd-keys">
      {keys.split(' oder ').map((alt, i) => (
        <span key={alt} className="kbd-keys__alt">
          {i > 0 && <span className="muted">oder</span>}
          {alt.split('+').map((k) => (
            <kbd key={k} className="kbd">
              {k.replace('Mod', MOD)}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Schrift',
    rows: [
      ['Fett', 'Mod+B'],
      ['Kursiv', 'Mod+I'],
      ['Unterstrichen', 'Mod+U'],
      ['Hervorheben', 'Mod+Umschalt+H'],
      ['Link', 'Mod+K'],
    ],
  },
  {
    title: 'Absatz',
    rows: [
      ['Überschrift 1, 2, 3', 'Mod+Alt+1'],
      ['Normaler Text', 'Mod+Alt+0'],
      ['Aufzählung', 'Mod+Umschalt+8'],
      ['Nummerierung', 'Mod+Umschalt+7'],
      ['Checkliste', 'Mod+Umschalt+9'],
      ['Listenpunkt ein-/ausrücken', 'Tab oder Umschalt+Tab'],
      ['Neue Zeile im Absatz', 'Umschalt+Enter'],
    ],
  },
  {
    title: 'Bearbeiten',
    rows: [
      ['Rückgängig', 'Mod+Z'],
      ['Wiederholen', 'Mod+Y'],
      ['Jetzt speichern', 'Mod+S'],
      ['Vom Titel in den Text', 'Enter'],
      ['Liste daneben ein-/ausblenden', 'Mod+Umschalt+L'],
      ['Diese Übersicht', 'Mod+#'],
    ],
  },
];

/** Schreibt man am Zeilenanfang, entsteht daraus das Format (wie in Markdown). */
const MARKDOWN: [string, string][] = [
  ['# ', 'Überschrift (## und ### kleiner)'],
  ['- ', 'Aufzählung'],
  ['1. ', 'Nummerierung'],
  ['[ ] ', 'Checkliste'],
  ['> ', 'Zitat'],
  ['---', 'Trennlinie'],
  ['**Text**', 'fett'],
  ['*Text*', 'kursiv'],
];

/**
 * Hilfe fürs Schreiben mit Tastatur (Tablet mit Tastatur, Laptop): Autokorrektur an/aus, Tastenkürzel, Kurzschreibweisen und
 * – unter Android – wo die Tastatur eingestellt wird.
 */
export function KeyboardSheet({ onClose }: { onClose: () => void }) {
  const auto = autocorrectSetting.use();
  return (
    <Sheet title="Tastatur & Schreibhilfe" onClose={onClose} wide>
      <button type="button" className="toggle toggle--switch kbd-toggle" aria-pressed={auto} onClick={() => autocorrectSetting.set(!auto)}>
        <span className="kbd-auto">
          <strong>Autokorrektur</strong>
          <span className="muted">
            Beim Schreiben mit Tastatur: Satzanfänge groß, häufige Tippfehler (udn → und), „deutsche“ Anführungszeichen, Gedankenstrich – und
            Auslassungspunkte …
          </span>
        </span>
        <span className="switch" aria-hidden="true" />
      </button>
      <p className="muted kbd-note">
        Eine Korrektur nimmst du mit der <kbd className="kbd">Rücktaste</kbd> direkt danach zurück. Rot unterstrichene Wörter: antippen oder
        Rechtsklick für Vorschläge (Rechtschreibprüfung des Geräts). Mit der Bildschirmtastatur korrigiert die Tastatur-App selbst. Die
        Einstellung gilt für dieses Gerät.
      </p>

      <div className="kbd-groups">
        {GROUPS.map((g) => (
          <section key={g.title} className="kbd-group">
            <h3 className="kbd-group__title">{g.title}</h3>
            <dl className="kbd-list">
              {g.rows.map(([label, keys]) => (
                <div key={label} className="kbd-row">
                  <dt>{label}</dt>
                  <dd>
                    <Keys keys={keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section className="kbd-group">
          <h3 className="kbd-group__title">Am Zeilenanfang tippen</h3>
          <dl className="kbd-list">
            {MARKDOWN.map(([typed, result]) => (
              <div key={typed} className="kbd-row">
                <dt>{result}</dt>
                <dd>
                  <code className="kbd-code">{typed.replace(/ $/, '␣')}</code>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {isAndroid && (
        <section className="kbd-group">
          <h3 className="kbd-group__title">Tastatur am Android-Tablet einrichten</h3>
          <ul className="kbd-tips">
            <li>
              <strong>Falsche Zeichen</strong> (y und z vertauscht, keine Umlaute)? In den Android-Einstellungen unter <em>Sprachen &amp; Eingabe › Physische Tastatur</em> das Layout <em>Deutsch</em> wählen.
            </li>
            <li>
              <strong>Vorschläge und Korrektur der Tastatur-App</strong>: Gboard kann auch bei angeschlossener Tastatur korrigieren und groß schreiben – in den Gboard-Einstellungen unter <em>Physische Tastatur</em>.
            </li>
            <li>Die Menünamen unterscheiden sich je nach Hersteller etwas (bei Xiaomi unter <em>Zusätzliche Einstellungen</em>).</li>
          </ul>
        </section>
      )}
    </Sheet>
  );
}
