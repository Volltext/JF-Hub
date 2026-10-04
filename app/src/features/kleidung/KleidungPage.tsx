import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Capacitor } from '@capacitor/core';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileSpreadsheet,
  FileText,
  Minus,
  Plus,
  Send,
  Settings2,
  Share2,
  Shirt,
  X,
} from 'lucide-react';
import { db } from '@/core/db/db';
import { todayIso } from '@/core/domain/id';
import type { Member } from '@/core/domain/types';
import { Button, Card, EmptyState, Page, Segmented, Sheet } from '@/core/ui/components';
import { confirmDialog } from '@/core/ui/dialog';
import { shareText, shareTextFile } from '@/core/native/files';
import {
  byMember,
  dateDe,
  exportCsv,
  exportText,
  listedMembers,
  nextRequestSize,
  openRequests,
  parseSizes,
  pdfRequest,
  slotOf,
  stepSize,
  totals,
  type ClothingItem,
  type ClothingRecord,
  type ClothingSlot,
  type OpenRequest,
} from './model';
import { clothingItemRepo, clothingRepo, ensureDefaultItems } from './repo';
import { shareClothingPdf } from './pdf';
import './kleidung.css';

type Tab = 'tabelle' | 'beschaffen';

const teile = (n: number) => `${n} ${n === 1 ? 'Teil' : 'Teile'}`;

/** Häufige Wortenden zusammengesetzter Kleidungsnamen. */
const TAILS = ['schuhe', 'jacke', 'hose', 'shirt', 'stiefel', 'helm', 'mütze', 'weste', 'pullover', 'hemd', 'kappe', 'brille', 'gürtel'];
const TAIL_RE = new RegExp(`(\\p{L}{3,})(${TAILS.join('|')})`, 'giu');

/** Weiches Trennzeichen vor bekannten Wortenden („Regen-jacke“), damit schmale Spaltenköpfe sauber umbrechen. */
const softHyphens = (name: string) => name.replace(TAIL_RE, '$1\u00AD$2');

/** Kleidertabelle der Gruppe: aktuelle Größen, neu zu beschaffende Teile und die Liste für den Kleiderwart. */
export function KleidungPage() {
  const members = useLiveQuery(() => db.members.orderBy('name').toArray(), []);
  const records = useLiveQuery(() => db.clothing.toArray(), []);
  const items = useLiveQuery(() => db.clothingItems.orderBy('order').toArray(), []);
  const location = useLocation();
  const [tab, setTab] = useState<Tab>('tabelle');
  const [personId, setPersonId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [editingItems, setEditingItems] = useState(false);

  useEffect(() => {
    void ensureDefaultItems();
  }, []);

  // Von der Startseite aus direkt die Beschaffungsliste öffnen.
  useEffect(() => {
    const wanted = (location.state as { tab?: Tab } | null)?.tab;
    if (wanted) {
      setTab(wanted);
      window.history.replaceState({}, '');
    }
  }, [location.key]);

  if (!members || !records || !items) return null;
  const active = members.filter((m) => m.active);
  const jugend = active.filter((m) => m.kind === 'jugendlich');
  const betreuer = active.filter((m) => m.kind === 'betreuer');
  const recordOf = new Map(records.map((r) => [r.id, r]));
  const requests = openRequests(active, records, items);
  // Reihenfolge für „Weiter“ im Bearbeiten-Fenster: wie in der Tabelle.
  const sequence = [...jugend, ...betreuer];
  const person = personId ? sequence.find((m) => m.id === personId) : undefined;
  const at = person ? sequence.indexOf(person) : -1;

  return (
    <Page
      title="Kleidung"
      sub={requests.length ? `${teile(requests.length)} zu beschaffen` : 'Kleidergrößen der Gruppe'}
      actions={
        <>
          <button type="button" className="icon-btn" aria-label="Kleidertabelle als PDF" title="Kleidertabelle als PDF" onClick={() => setExporting(true)}>
            <FileText size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label="Kleidungsstücke und Größen bearbeiten" title="Kleidungsstücke und Größen bearbeiten" onClick={() => setEditingItems(true)}>
            <Settings2 size={20} />
          </button>
        </>
      }
    >
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'tabelle', label: 'Kleidertabelle' },
          { value: 'beschaffen', label: requests.length ? `Zu beschaffen (${requests.length})` : 'Zu beschaffen' },
        ]}
      />

      {tab === 'tabelle' ? (
        <TableView jugend={jugend} betreuer={betreuer} items={items} recordOf={recordOf} onOpen={setPersonId} />
      ) : (
        <ProcurementView requests={requests} onOpen={setPersonId} onExport={() => setExporting(true)} />
      )}

      {person && (
        <PersonSheet
          key={person.id}
          member={person}
          record={recordOf.get(person.id)}
          items={items}
          prev={sequence[at - 1]}
          next={sequence[at + 1]}
          onNavigate={setPersonId}
          onClose={() => setPersonId(null)}
        />
      )}
      {exporting && <ExportSheet requests={requests} members={active} records={records} items={items} onClose={() => setExporting(false)} />}
      {editingItems && <ItemsSheet items={items} onClose={() => setEditingItems(false)} />}
    </Page>
  );
}

// ---------- Kleidertabelle ----------

function TableView(props: {
  jugend: Member[];
  betreuer: Member[];
  items: ClothingItem[];
  recordOf: Map<string, ClothingRecord>;
  onOpen: (id: string) => void;
}) {
  const { jugend, betreuer, items, recordOf, onOpen } = props;
  if (!jugend.length && !betreuer.length)
    return (
      <EmptyState icon={Shirt} title="Noch keine Mitglieder">
        Lege zuerst unter <Link to="/mitglieder">Mitglieder</Link> die Gruppe an.
      </EmptyState>
    );
  if (!items.length)
    return (
      <EmptyState icon={Shirt} title="Keine Kleidungsstücke">
        Über das Zahnrad oben rechts Kleidungsstücke und ihre Größen anlegen.
      </EmptyState>
    );
  const betreuerHaveData = betreuer.some((m) => Object.keys(recordOf.get(m.id)?.items ?? {}).length > 0);

  return (
    <>
      {jugend.length > 0 && <SizeTable members={jugend} items={items} recordOf={recordOf} onOpen={onOpen} />}
      {betreuer.length > 0 && (
        <details className="acc" open={betreuerHaveData || !jugend.length}>
          <summary>Betreuer ({betreuer.length})</summary>
          <SizeTable members={betreuer} items={items} recordOf={recordOf} onOpen={onOpen} />
        </details>
      )}
      <p className="muted kl-legend">
        Person antippen, um Größen einzutragen. <span className="kl-new">→ 56</span> neu zu beschaffen,{' '}
        <span className="kl-new kl-new--passed">→ 56</span> beim Kleiderwart.
      </p>
    </>
  );
}

const NAME_MIN = 84;
const CELL_MIN = 50;

function SizeTable({ members, items, recordOf, onOpen }: { members: Member[]; items: ClothingItem[]; recordOf: Map<string, ClothingRecord>; onOpen: (id: string) => void }) {
  const cols = `minmax(${NAME_MIN}px, 1.4fr) repeat(${items.length}, minmax(${CELL_MIN}px, 1fr))`;
  // Feste Mindestbreite: bei vielen Kleidungsstücken scrollt die Tabelle seitlich statt zu quetschen.
  const minWidth = NAME_MIN + items.length * (CELL_MIN + 4) + 20;
  return (
    <div className="kl-table">
      <div className="kl-table__inner" style={{ minWidth }}>
        <div className="kl-row kl-row--head" style={{ gridTemplateColumns: cols }} lang="de">
          <span>Name</span>
          {items.map((i) => (
            <span key={i.id}>{softHyphens(i.name)}</span>
          ))}
        </div>
        {members.map((m) => {
          const rec = recordOf.get(m.id);
          return (
            <button key={m.id} type="button" className="kl-row" style={{ gridTemplateColumns: cols }} onClick={() => onOpen(m.id)}>
              <span className="kl-name">{m.name}</span>
              {items.map((i) => {
                const s = slotOf(rec, i.id);
                return (
                  <span key={i.id} className="kl-cell">
                    <span className={s.current ? undefined : 'muted'}>{s.current || '–'}</span>
                    {s.request && <span className={`kl-new${s.request.passedOn ? ' kl-new--passed' : ''}`}>→ {s.request.size}</span>}
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Eine Person bearbeiten ----------

function PersonSheet(props: {
  member: Member;
  record: ClothingRecord | undefined;
  items: ClothingItem[];
  prev: Member | undefined;
  next: Member | undefined;
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const { member, record, items, prev, next } = props;
  const [picking, setPicking] = useState<{ item: ClothingItem; kind: 'current' | 'request' } | null>(null);
  const pickedSlot = picking ? slotOf(record, picking.item.id) : null;

  return (
    <Sheet title={member.name} onClose={props.onClose}>
      <div className="stack">
        {items.map((item) => (
          <SlotEditor key={item.id} memberId={member.id} item={item} slot={slotOf(record, item.id)} onPick={(kind) => setPicking({ item, kind })} />
        ))}
      </div>

      <div className="kl-nav">
        <Button className="kl-btn" disabled={!prev} aria-label={prev ? `Zurück zu ${prev.name}` : 'Zurück'} onClick={() => prev && props.onNavigate(prev.id)}>
          <ChevronLeft size={18} />
        </Button>
        {next ? (
          <Button className="kl-btn kl-nav__next" onClick={() => props.onNavigate(next.id)}>
            <span className="kl-ellipsis">Weiter: {next.name}</span>
            <ChevronRight size={18} />
          </Button>
        ) : (
          <Button className="kl-btn kl-nav__next" variant="primary" onClick={props.onClose}>
            Fertig
          </Button>
        )}
      </div>

      {picking && pickedSlot && (
        <SizeSheet
          title={`${picking.item.name}: ${picking.kind === 'current' ? 'aktuelle Größe' : 'neue Größe'}`}
          item={picking.item}
          value={picking.kind === 'current' ? pickedSlot.current : (pickedSlot.request?.size ?? '')}
          noneLabel={picking.kind === 'current' ? 'Größe entfernen' : 'Nichts beschaffen'}
          onClose={() => setPicking(null)}
          onPick={async (size) => {
            if (picking.kind === 'current') await clothingRepo.setCurrent(member.id, picking.item.id, size);
            else await clothingRepo.setRequest(member.id, picking.item.id, size || null);
            setPicking(null);
          }}
        />
      )}
    </Sheet>
  );
}

function SlotEditor({ memberId, item, slot, onPick }: { memberId: string; item: ClothingItem; slot: ClothingSlot; onPick: (kind: 'current' | 'request') => void }) {
  const up = nextRequestSize(item, slot);
  const req = slot.request;
  const down = req ? stepSize(item, req.size, -1) : null;

  return (
    <div className="kl-slot">
      <div className="kl-slot__head">
        <strong>{item.name}</strong>
        <button type="button" className="kl-size" onClick={() => onPick('current')} aria-label={`${item.name}: aktuelle Größe ${slot.current || 'nicht eingetragen'}, ändern`}>
          <span className="kl-size__label">Aktuell</span>
          <span className="kl-size__value">{slot.current || '–'}</span>
          <ChevronDown size={16} />
        </button>
      </div>

      {req ? (
        <div className="kl-slot__req">
          <button type="button" className="stepper-btn" aria-label="Eine Größe kleiner" disabled={!down} onClick={() => void clothingRepo.setRequest(memberId, item.id, down)}>
            <Minus size={16} />
          </button>
          <button type="button" className="kl-req-size" aria-label={`Neue Größe ${req.size}, ändern`} onClick={() => onPick('request')}>
            {req.size}
          </button>
          <button type="button" className="stepper-btn" aria-label="Eine Größe größer" disabled={!up} onClick={() => void clothingRepo.setRequest(memberId, item.id, up)}>
            <Plus size={16} />
          </button>
          <span className="kl-req-actions">
            <Button className="kl-btn" onClick={() => void clothingRepo.received(memberId, item.id)} title="Ausgegeben: wird zur aktuellen Größe">
              <Check size={16} /> Erhalten
            </Button>
            <button type="button" className="icon-btn" aria-label="Nichts beschaffen" title="Nichts beschaffen" onClick={() => void clothingRepo.setRequest(memberId, item.id, null)}>
              <X size={18} />
            </button>
          </span>
        </div>
      ) : (
        <div className="kl-slot__req">
          {up && (
            <Button className="kl-btn kl-up" onClick={() => void clothingRepo.setRequest(memberId, item.id, up)}>
              <ArrowUp size={16} /> {up} beschaffen
            </Button>
          )}
          <Button className="kl-btn" onClick={() => onPick('request')}>
            {up ? 'Andere Größe' : 'Neue Größe beschaffen'}
          </Button>
        </div>
      )}

      {req && (
        <div className="kl-slot__note">
          <span className="kl-req-tag">Neue Größe</span>
          <span className="muted"> · {req.passedOn ? `beim Kleiderwart seit ${dateDe(req.passedOn)}` : 'noch nicht an den Kleiderwart gegeben'}</span>
        </div>
      )}
    </div>
  );
}

function SizeSheet(props: {
  title: string;
  item: ClothingItem;
  value: string;
  noneLabel: string;
  onPick: (size: string) => void;
  onClose: () => void;
}) {
  const { item, value } = props;
  const [text, setText] = useState(value && !item.sizes.includes(value) ? value : '');
  return (
    <Sheet title={props.title} onClose={props.onClose}>
      {item.sizes.length > 0 && (
        <div className="tp-grid">
          {item.sizes.map((s) => (
            <button key={s} type="button" className="tp-cell" aria-pressed={s === value} onClick={() => props.onPick(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="kl-other"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) props.onPick(text.trim());
        }}
      >
        <label className="field">
          <span>Andere Größe</span>
          <input value={text} placeholder="z. B. 165 / XS" onChange={(e) => setText(e.target.value)} />
        </label>
        <Button type="submit" disabled={!text.trim()}>
          Übernehmen
        </Button>
      </form>
      {value && <Button onClick={() => props.onPick('')}>{props.noneLabel}</Button>}
    </Sheet>
  );
}

// ---------- Zu beschaffen ----------

function ProcurementView({ requests, onOpen, onExport }: { requests: OpenRequest[]; onOpen: (id: string) => void; onExport: () => void }) {
  if (!requests.length)
    return (
      <EmptyState icon={Shirt} title="Nichts zu beschaffen">
        In der Kleidertabelle eine Person antippen und bei einem Kleidungsstück „↑ … beschaffen“ wählen.
      </EmptyState>
    );

  return (
    <>
      <Card title="Gesamt">
        <div className="kl-totals">
          {totals(requests).map(({ item, sizes }) => (
            <div key={item.id} className="kl-total">
              <span className="muted">{item.name}</span>
              <strong>{sizes.map((s) => `${s.count}× ${s.size}`).join(' · ')}</strong>
            </div>
          ))}
        </div>
      </Card>

      <Button variant="primary" className="kl-btn" onClick={onExport}>
        <Share2 size={18} /> Für den Kleiderwart exportieren
      </Button>

      {byMember(requests).map(({ member, requests: rs }) => (
        <section key={member.id} className="card">
          <div className="card__head">
            <h2 className="card__title">{member.name}</h2>
            <button type="button" className="card__link kl-linkbtn" onClick={() => onOpen(member.id)}>
              Bearbeiten
            </button>
          </div>
          <div className="list">
            {rs.map((r) => (
              <div key={r.item.id} className="kl-req-row">
                <div className="item__main">
                  <div className="item__title">
                    {r.item.name}: {r.request.size}
                  </div>
                  <div className="item__sub">
                    {r.current ? `bisher ${r.current} · ` : ''}
                    {r.request.passedOn ? `beim Kleiderwart seit ${dateDe(r.request.passedOn)}` : 'neu'}
                  </div>
                </div>
                <Button className="kl-btn" onClick={() => void clothingRepo.received(r.member.id, r.item.id)} title="Ausgegeben: wird zur aktuellen Größe">
                  <Check size={16} /> Erhalten
                </Button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

// ---------- Export für den Kleiderwart ----------

const isCancel = (e: unknown) => e instanceof Error && /cancel/i.test(e.message);

function ExportSheet(props: { requests: OpenRequest[]; members: Member[]; records: ClothingRecord[]; items: ClothingItem[]; onClose: () => void }) {
  const { requests, records, items } = props;
  const fresh = requests.filter((r) => !r.request.passedOn);
  const [scope, setScope] = useState<'neu' | 'alle'>(fresh.length ? 'neu' : 'alle');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = scope === 'neu' && fresh.length ? fresh : requests;
  const today = todayIso();
  const native = Capacitor.isNativePlatform();
  const listed = listedMembers(props.members, records);
  const sums = totals(chosen);

  /** Nach dem Weitergeben: Wünsche als „beim Kleiderwart“ markieren, damit die nächste Liste nur Neues enthält. */
  async function afterShare() {
    const unmarked = chosen.filter((r) => !r.request.passedOn);
    if (!unmarked.length) return;
    const ok = await confirmDialog(
      `${teile(unmarked.length)} als „beim Kleiderwart“ markieren? Beim nächsten Export lassen sich dann neue Wünsche getrennt schicken.`,
      { title: 'Liste weitergegeben?', confirmLabel: 'Markieren', cancelLabel: 'Nicht markieren' },
    );
    if (!ok) return;
    await clothingRepo.markPassedOn(unmarked.map((r) => ({ memberId: r.member.id, itemId: r.item.id })));
    props.onClose();
  }

  async function run(fn: () => Promise<void>) {
    setMsg('');
    setBusy(true);
    try {
      await fn();
      await afterShare();
    } catch (e) {
      if (!isCancel(e)) setMsg(e instanceof Error ? e.message : 'Export fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Für den Kleiderwart" onClose={props.onClose}>
      {fresh.length > 0 && fresh.length < requests.length && (
        <Segmented<'neu' | 'alle'>
          value={scope}
          onChange={setScope}
          options={[
            { value: 'neu', label: `Nur neue (${fresh.length})` },
            { value: 'alle', label: `Alle offenen (${requests.length})` },
          ]}
        />
      )}

      <div className="kl-export">
        <div className="kl-export__head">
          <FileText size={20} />
          <div>
            <strong>Kleidertabelle als PDF</strong>
            <div className="muted kl-small">
              {chosen.length ? `${teile(chosen.length)} zu beschaffen` : 'Nichts zu beschaffen'} · Größen von {listed.length} Personen
            </div>
          </div>
        </div>
        {sums.length > 0 && (
          <div className="kl-totals">
            {sums.map(({ item, sizes }) => (
              <div key={item.id} className="kl-total">
                <span className="muted">{item.name}</span>
                <strong>{sizes.map((s) => `${s.count}× ${s.size}`).join(' · ')}</strong>
              </div>
            ))}
          </div>
        )}
        <p className="muted kl-small" style={{ margin: 0 }}>
          Oben die Sammelliste zum Bestellen, darunter alle Größen wie in der Kleidertabelle{fresh.length && chosen.length ? ', neue Teile farbig hervorgehoben' : ''}.
        </p>
      </div>

      <Button variant="primary" className="kl-btn" disabled={busy} onClick={() => void run(() => shareClothingPdf(pdfRequest(listed, records, items, chosen, today)))}>
        <FileText size={18} /> {busy ? 'PDF wird erstellt …' : native ? 'PDF erstellen und teilen' : 'PDF herunterladen'}
      </Button>

      <div className="group-label">Weitere Formate</div>
      <div className="kl-alt">
        <Button
          className="kl-btn"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if ((await shareText('Kleidung zu beschaffen', exportText(chosen, today))) === 'copied') setMsg('Text in die Zwischenablage kopiert.');
            })
          }
        >
          {native ? <Send size={16} /> : <Copy size={16} />} {native ? 'Als Text' : 'Text kopieren'}
        </Button>
        <Button className="kl-btn" disabled={busy} onClick={() => void run(() => shareTextFile(`Kleidertabelle ${today}.csv`, exportCsv(listed, records, items, chosen, today), 'text/csv'))}>
          <FileSpreadsheet size={16} /> Excel (CSV)
        </Button>
      </div>

      {msg && (
        <p className="muted" role="status" style={{ margin: 0 }}>
          {msg}
        </p>
      )}
    </Sheet>
  );
}

// ---------- Kleidungsstücke verwalten ----------

function ItemsSheet({ items, onClose }: { items: ClothingItem[]; onClose: () => void }) {
  const [edit, setEdit] = useState<{ id?: string; name: string; sizes: string } | null>(null);
  return (
    <Sheet title="Kleidungsstücke" onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>
        Die Reihenfolge der Größen legt fest, was „eine Größe größer“ ist.
      </p>
      <div className="list">
        {items.map((it, i) => (
          <div key={it.id} className="item" style={{ cursor: 'default' }}>
            <button type="button" className="item__main kl-plain" onClick={() => setEdit({ id: it.id, name: it.name, sizes: it.sizes.join(', ') })}>
              <div className="item__title">{it.name}</div>
              <div className="item__sub">{it.sizes.length ? `${it.sizes[0]} … ${it.sizes.at(-1)} (${it.sizes.length} Größen)` : 'ohne Größenreihe'}</div>
            </button>
            <button type="button" className="stepper-btn" aria-label={`${it.name} nach oben`} disabled={i === 0} onClick={() => void clothingItemRepo.move(it.id, -1)}>
              <ArrowUp size={16} />
            </button>
            <button type="button" className="stepper-btn" aria-label={`${it.name} nach unten`} disabled={i === items.length - 1} onClick={() => void clothingItemRepo.move(it.id, 1)}>
              <ArrowDown size={16} />
            </button>
          </div>
        ))}
      </div>
      <Button className="kl-btn" onClick={() => setEdit({ name: '', sizes: '' })}>
        <Plus size={18} /> Kleidungsstück hinzufügen
      </Button>
      {edit && <ItemEditSheet draft={edit} onClose={() => setEdit(null)} />}
    </Sheet>
  );
}

function ItemEditSheet({ draft, onClose }: { draft: { id?: string; name: string; sizes: string }; onClose: () => void }) {
  const [name, setName] = useState(draft.name);
  const [sizes, setSizes] = useState(draft.sizes);
  const [error, setError] = useState('');
  const parsed = parseSizes(sizes);

  async function save() {
    try {
      if (draft.id) await clothingItemRepo.update(draft.id, name, parsed);
      else await clothingItemRepo.add(name, parsed);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  }

  return (
    <Sheet title={draft.id ? 'Kleidungsstück bearbeiten' : 'Neues Kleidungsstück'} onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input autoFocus={!draft.id} value={name} placeholder="z. B. T-Shirt" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Größen von klein nach groß, mit Komma getrennt</span>
        <textarea className="textarea" rows={4} value={sizes} placeholder="z. B. 128, 140, 152, 164, S, M, L" onChange={(e) => setSizes(e.target.value)} />
      </label>
      {parsed.length > 0 && <div className="chips-row">{parsed.map((s) => <span key={s} className="chip">{s}</span>)}</div>}
      {error && (
        <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>
          {error}
        </p>
      )}
      <Button variant="primary" onClick={() => void save()}>
        Speichern
      </Button>
      {draft.id && (
        <Button
          variant="danger"
          onClick={async () => {
            if (await confirmDialog(`„${draft.name}“ aus der Kleidertabelle entfernen? Die dazu eingetragenen Größen werden nicht mehr angezeigt.`, { danger: true, confirmLabel: 'Entfernen' })) {
              await clothingItemRepo.remove(draft.id!);
              onClose();
            }
          }}
        >
          Entfernen
        </Button>
      )}
    </Sheet>
  );
}
