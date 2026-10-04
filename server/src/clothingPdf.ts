import { MUTED, RULE, TEXT, accentRule, pageFrame, renderDefinition, type PdfStyle } from './pdf.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * Kleidertabelle als PDF (für den Kleiderwart). Die App stellt die Zeilen zusammen – so steht im PDF genau,
 * was sie anzeigt –, der Server übernimmt nur das Layout im Stil der Protokoll-PDFs.
 */
export interface ClothingPdfRow {
  name: string;
  /** Aktuelle Größe je Kleidungsstück (Reihenfolge wie `items`). */
  current: string[];
  /** Neu zu beschaffende Größe je Kleidungsstück; '' = nichts. */
  wanted: string[];
  /** true = neu seit der letzten Liste an den Kleiderwart (wird hervorgehoben). */
  fresh: boolean[];
}

export interface ClothingPdfRequest {
  /** YYYY-MM-DD */
  date: string;
  items: string[];
  groups: { label: string; rows: ClothingPdfRow[] }[];
  totals: { item: string; sizes: { size: string; count: number }[] }[];
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

/** Prüft und begrenzt die Anfrage der App; wirft, wenn sie unbrauchbar ist. */
export function parseClothingPdf(raw: unknown): ClothingPdfRequest {
  if (!raw || typeof raw !== 'object') throw new Error('Ungültige Anfrage');
  const r = raw as Record<string, unknown>;
  const items = list(r.items, 20).map((i) => str(i, 60));
  if (!items.length) throw new Error('Keine Kleidungsstücke angegeben');
  const n = items.length;
  const cells = (v: unknown) => Array.from({ length: n }, (_, i) => (Array.isArray(v) ? str(v[i], 40) : ''));
  const groups = list(r.groups, 10).map((g) => {
    const group = (g ?? {}) as Record<string, unknown>;
    return {
      label: str(group.label, 60),
      rows: list(group.rows, 500).map((x) => {
        const row = (x ?? {}) as Record<string, unknown>;
        return {
          name: str(row.name, 80),
          current: cells(row.current),
          wanted: cells(row.wanted),
          fresh: Array.from({ length: n }, (_, i) => Array.isArray(row.fresh) && row.fresh[i] === true),
        };
      }),
    };
  });
  const totals = list(r.totals, 50).map((t) => {
    const total = (t ?? {}) as Record<string, unknown>;
    return {
      item: str(total.item, 60),
      sizes: list(total.sizes, 100).map((x) => {
        const s = (x ?? {}) as Record<string, unknown>;
        return { size: str(s.size, 40), count: Math.max(0, Math.min(9999, Math.round(Number(s.count) || 0))) };
      }),
    };
  });
  const date = str(r.date, 10);
  return { date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10), items, groups, totals };
}

/** Helle Tönung einer Hex-Farbe (Hintergrund hervorgehobener Zellen). */
export function tint(hex: string, amount = 0.84): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#fdeceb';
  const n = parseInt(m[1]!, 16);
  return (
    '#' +
    [16, 8, 0]
      .map((shift) => {
        const c = (n >> shift) & 255;
        return Math.round(c + (255 - c) * amount)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

/** Häufige Wortenden zusammengesetzter Kleidungsnamen. */
const TAIL = /(\p{L}{3,})(schuhe|jacke|hose|shirt|stiefel|helm|mütze|weste|pullover|hemd|kappe|brille|gürtel)$/iu;

/**
 * Lange Namen für schmale Spaltenköpfe vor einem bekannten Wortende trennen („Hand-/schuhe“),
 * statt sie mitten im Wort umbrechen zu lassen. Namen mit Leer- oder Bindestrich brechen dort von selbst.
 */
export function breakLabel(name: string): string {
  if (name.length <= 8 || /[\s-]/.test(name)) return name;
  return name.replace(TAIL, '$1-\n$2');
}

const dateDe = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const teile = (n: number) => `${n} ${n === 1 ? 'Teil' : 'Teile'}`;
const ZEBRA = '#f6f7f9';
const GROUP = '#eceef1';

/** Baut die pdfmake-Definition (rein, ohne I/O – gut testbar). */
export function buildClothingDoc(req: ClothingPdfRequest, st: PdfStyle): Any {
  const n = req.items.length;
  // Ab sechs Kleidungsstücken (zwölf Größenspalten) wird quer gedruckt.
  const landscape = n > 5;
  const usable = (landscape ? 842 : 595) - 100;
  const pad = 3;
  const colW = Math.max(26, Math.min(56, Math.floor((usable - 110 - 2 * n * 2 * pad) / (2 * n))));
  const highlight = tint(st.accent);

  const total = req.totals.reduce((sum, t) => sum + t.sizes.reduce((a, s) => a + s.count, 0), 0);
  const people = req.groups.reduce((sum, g) => sum + g.rows.length, 0);
  const rows = req.groups.flatMap((g) => g.rows);
  const anyFresh = rows.some((r) => r.fresh.some((f, i) => f && r.wanted[i]));
  const anyPassed = rows.some((r) => r.wanted.some((w, i) => w && !r.fresh[i]));

  const content: Any[] = [
    { text: 'Kleidertabelle', fontSize: 22, bold: true, color: TEXT, margin: [0, 0, 0, 4] },
    {
      text: `Stand ${dateDe(req.date)} · ${people} ${people === 1 ? 'Person' : 'Personen'} · ${total ? `${teile(total)} zu beschaffen` : 'nichts zu beschaffen'}`,
      color: MUTED,
      fontSize: 10,
    },
    accentRule(st, usable),
  ];

  // ---- Sammelliste zum Bestellen ----
  content.push({ text: 'Zu beschaffen', fontSize: 13, bold: true, color: st.accent, margin: [0, 0, 0, 6] });
  const totalRows = req.totals.filter((t) => t.sizes.some((s) => s.count > 0));
  if (!totalRows.length) {
    content.push({ text: 'Zurzeit wird nichts benötigt.', color: MUTED, margin: [0, 0, 0, 4] });
  } else {
    const head = (text: string, alignment = 'left') => ({ text, bold: true, fontSize: 8.5, color: MUTED, alignment });
    const body: Any[][] = [[head('Kleidungsstück'), head('Größe', 'center'), head('Anzahl', 'right')]];
    for (const t of totalRows) {
      const sizes = t.sizes.filter((s) => s.count > 0);
      sizes.forEach((s, i) =>
        body.push([
          i === 0 ? { text: t.item, bold: true, rowSpan: sizes.length } : {},
          { text: s.size, alignment: 'center' },
          { text: String(s.count), alignment: 'right' },
        ]),
      );
    }
    body.push([{ text: 'Gesamt', bold: true }, {}, { text: String(total), bold: true, alignment: 'right' }]);
    const last = body.length;
    content.push({
      table: { headerRows: 1, dontBreakRows: true, widths: [170, 70, 50], body },
      layout: {
        hLineWidth: (i: number) => (i === 1 || i === last - 1 ? 1 : i === 0 || i === last ? 0 : 0.5),
        vLineWidth: () => 0,
        hLineColor: (i: number) => (i === 1 || i === last - 1 ? TEXT : RULE),
        paddingTop: () => 3,
        paddingBottom: () => 3,
      },
      margin: [0, 0, 0, 4],
    });
  }

  // ---- Kleidertabelle aller Personen ----
  content.push({ text: 'Größenübersicht', fontSize: 13, bold: true, color: st.accent, margin: [0, 16, 0, 6] });
  const cols = 1 + 2 * n;
  const spanRow = (first: Any, count: number) => [first, ...Array.from({ length: count - 1 }, () => ({}))];
  const small = (text: string) => ({ text: breakLabel(text), bold: true, fontSize: 8, color: MUTED, alignment: 'center' });
  const body: Any[][] = [
    [
      { text: '' },
      ...spanRow({ text: 'Aktuelle Größe', bold: true, fontSize: 9, alignment: 'center', colSpan: n }, n),
      ...spanRow({ text: 'Neu zu beschaffen', bold: true, fontSize: 9, alignment: 'center', color: st.accent, colSpan: n }, n),
    ],
    [{ text: 'Name', bold: true, fontSize: 8, color: MUTED }, ...req.items.map(small), ...req.items.map(small)],
  ];
  const showLabels = req.groups.filter((g) => g.rows.length).length > 1;
  let zebra = 0;
  for (const g of req.groups) {
    if (!g.rows.length) continue;
    if (showLabels) body.push(spanRow({ text: g.label, bold: true, fontSize: 9, fillColor: GROUP, colSpan: cols }, cols));
    for (const r of g.rows) {
      const fill = zebra++ % 2 === 1 ? ZEBRA : undefined;
      body.push([
        { text: r.name, bold: true, fillColor: fill },
        ...r.current.map((c) => ({ text: c || '–', alignment: 'center', color: c ? TEXT : MUTED, fillColor: fill })),
        ...r.wanted.map((w, i) => {
          const fresh = !!w && r.fresh[i];
          return { text: w, alignment: 'center', bold: !!w, color: fresh ? st.accent : TEXT, fillColor: fresh ? highlight : fill };
        }),
      ]);
    }
  }
  content.push({
    table: { headerRows: 2, dontBreakRows: true, widths: ['*', ...Array.from({ length: 2 * n }, () => colW)], body },
    layout: {
      // Kräftige Linien unter dem Kopf und zwischen „aktuell“ und „neu“, sonst feine Zeilenlinien.
      hLineWidth: (i: number, node: Any) => (i === 2 ? 1 : i === 0 || i === node.table.body.length ? 0 : 0.4),
      hLineColor: (i: number) => (i === 2 ? TEXT : RULE),
      vLineWidth: (i: number) => (i === 1 + n ? 1 : i === 1 ? 0.4 : 0),
      vLineColor: (i: number) => (i === 1 + n ? TEXT : RULE),
      paddingLeft: () => pad,
      paddingRight: () => pad,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
  });
  if (anyFresh && anyPassed) {
    content.push({
      text: [{ text: 'Farbig hinterlegt', bold: true, color: st.accent }, { text: ': neu seit der letzten Liste. Die übrigen Teile wurden bereits angefragt.' }],
      fontSize: 8.5,
      color: MUTED,
      margin: [0, 6, 0, 0],
    });
  }

  return { ...pageFrame(st, `Kleidertabelle ${dateDe(req.date)}`, landscape ? 'landscape' : 'portrait'), content };
}

export function renderClothingPdf(req: ClothingPdfRequest, st: PdfStyle): Promise<Buffer> {
  return renderDefinition(buildClothingDoc(req, st));
}
