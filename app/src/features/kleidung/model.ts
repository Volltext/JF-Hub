import type { Member } from '@/core/domain/types';
import { csvCell } from '@/features/wettkampf/csv';

/** Art eines Kleidungsstücks (z. B. Kombi-Jacke) mit seiner Größenreihe. */
export interface ClothingItem {
  id: string;
  name: string;
  /** Größen von klein nach groß – die Reihenfolge bestimmt „eine Größe größer“. */
  sizes: string[];
  order: number;
}

/** Gewünschte neue Größe, bis das Teil ausgegeben ist. */
export interface ClothingRequest {
  size: string;
  /** YYYY-MM-DD */
  requestedAt: string;
  /** Datum, an dem die Liste an den Kleiderwart ging; null = noch nicht weitergegeben. */
  passedOn: string | null;
}

export interface ClothingSlot {
  /** Aktuelle Größe; '' = nicht bekannt bzw. nicht vorhanden. */
  current: string;
  request: ClothingRequest | null;
}

/** Kleidung eines Mitglieds; `id` ist die Mitglieds-ID. */
export interface ClothingRecord {
  id: string;
  items: Record<string, ClothingSlot>;
}

const KIDS = ['128', '134', '140', '146', '152', '158', '164', '170', '176'];
const MEN = ['44', '46', '48', '50', '52', '54', '56', '58', '60', '62', '64'];
const LETTERS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
const GLOVES = ['4', '5', '6', '7', '8', '9', '10', '11', '12'];

/** Startausstattung wie in der bisherigen Kleidertabelle; Namen und Größenreihen sind in der App änderbar. */
export const DEFAULT_ITEMS: ClothingItem[] = [
  { id: 'kombi-jacke', name: 'Kombi-Jacke', sizes: [...KIDS, ...MEN], order: 0 },
  { id: 'kombi-hose', name: 'Kombi-Hose', sizes: [...KIDS, ...MEN], order: 1 },
  { id: 'regenjacke', name: 'Regenjacke', sizes: [...KIDS, ...LETTERS], order: 2 },
  { id: 'handschuhe', name: 'Handschuhe', sizes: GLOVES, order: 3 },
];

export const EMPTY_SLOT: ClothingSlot = { current: '', request: null };

export const slotOf = (rec: ClothingRecord | undefined, itemId: string): ClothingSlot => rec?.items[itemId] ?? EMPTY_SLOT;

/** Größe `delta` Schritte weiter in der Reihe; null, wenn die Größe nicht in der Reihe steht oder das Ende erreicht ist. */
export function stepSize(item: ClothingItem, size: string, delta: number): string | null {
  const i = item.sizes.indexOf(size);
  if (i < 0) return null;
  return item.sizes[i + delta] ?? null;
}

/**
 * Vorschlag für „eine Größe größer“: ausgehend von einer schon gewünschten Größe, sonst von der aktuellen.
 * null, wenn sich keine nächste Größe bestimmen lässt.
 */
export function nextRequestSize(item: ClothingItem, slot: ClothingSlot): string | null {
  return stepSize(item, slot.request?.size || slot.current, 1);
}

/** Größenliste aus einer Eingabe („128, 134; 140“) – Leerstellen entfernt, doppelte nur einmal. */
export function parseSizes(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const s = raw.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export interface OpenRequest {
  member: Member;
  item: ClothingItem;
  current: string;
  request: ClothingRequest;
}

/** Alle offenen Wünsche aktiver Mitglieder, nach Name und dann nach Kleidungsstück geordnet. */
export function openRequests(members: Member[], records: ClothingRecord[], items: ClothingItem[]): OpenRequest[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const sortedItems = [...items].sort((a, b) => a.order - b.order);
  const out: OpenRequest[] = [];
  for (const member of [...members].sort((a, b) => a.name.localeCompare(b.name, 'de'))) {
    if (!member.active) continue;
    const rec = byId.get(member.id);
    for (const item of sortedItems) {
      const slot = slotOf(rec, item.id);
      if (slot.request) out.push({ member, item, current: slot.current, request: slot.request });
    }
  }
  return out;
}

export interface SizeCount {
  size: string;
  count: number;
}

/** Sammelliste zum Bestellen: je Kleidungsstück die Größen mit Anzahl, in der Reihenfolge der Größenreihe. */
export function totals(requests: OpenRequest[]): { item: ClothingItem; sizes: SizeCount[] }[] {
  const groups = new Map<string, { item: ClothingItem; counts: Map<string, number> }>();
  for (const r of requests) {
    const g = groups.get(r.item.id) ?? { item: r.item, counts: new Map<string, number>() };
    g.counts.set(r.request.size, (g.counts.get(r.request.size) ?? 0) + 1);
    groups.set(r.item.id, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.item.order - b.item.order)
    .map(({ item, counts }) => {
      // Größen außerhalb der Reihe ans Ende, untereinander alphabetisch.
      const rank = (s: string) => {
        const i = item.sizes.indexOf(s);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      const sizes = [...counts.entries()]
        .map(([size, count]) => ({ size, count }))
        .sort((a, b) => rank(a.size) - rank(b.size) || a.size.localeCompare(b.size, 'de', { numeric: true }));
      return { item, sizes };
    });
}

/** Nach Person gruppiert (Reihenfolge wie in `requests`). */
export function byMember(requests: OpenRequest[]): { member: Member; requests: OpenRequest[] }[] {
  const out: { member: Member; requests: OpenRequest[] }[] = [];
  for (const r of requests) {
    const last = out.at(-1);
    if (last && last.member.id === r.member.id) last.requests.push(r);
    else out.push({ member: r.member, requests: [r] });
  }
  return out;
}

/** YYYY-MM-DD → TT.MM.JJJJ */
export const dateDe = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

/** Nachricht für den Kleiderwart (WhatsApp, E-Mail): erst die Sammelliste, dann die Verteilung je Person. */
export function exportText(requests: OpenRequest[], today: string, title = 'Jugendfeuerwehr – Kleidung zu beschaffen'): string {
  const lines = [title, `Stand: ${dateDe(today)}`, ''];
  if (!requests.length) return [...lines, 'Zurzeit wird nichts benötigt.'].join('\n');
  lines.push(`Gesamt (${requests.length} ${requests.length === 1 ? 'Teil' : 'Teile'})`);
  for (const { item, sizes } of totals(requests)) {
    lines.push(`• ${item.name}: ${sizes.map((s) => `${s.count}× ${s.size}`).join(', ')}`);
  }
  lines.push('', 'Je Person');
  for (const { member, requests: rs } of byMember(requests)) {
    lines.push(member.name);
    for (const r of rs) lines.push(`  – ${r.item.name}: ${r.request.size}${r.current ? ` (bisher ${r.current})` : ''}`);
  }
  return lines.join('\n');
}

/**
 * Kleidertabelle für Excel: aktuelle Größen aller aufgeführten Mitglieder, rechts die neu zu beschaffenden
 * (aufgebaut wie die bisherige Excel-Liste), darunter die Sammelliste.
 * `requests` legt fest, welche Wünsche in den NEU-Spalten erscheinen.
 */
export function exportCsv(
  members: Member[],
  records: ClothingRecord[],
  items: ClothingItem[],
  requests: OpenRequest[],
  today: string,
): string {
  const sortedItems = [...items].sort((a, b) => a.order - b.order);
  const byId = new Map(records.map((r) => [r.id, r]));
  const wanted = new Map(requests.map((r) => [`${r.member.id}:${r.item.id}`, r.request.size]));
  const row = (cells: unknown[]) => cells.map(csvCell).join(';');

  const lines = [
    row(['JF Kleidertabelle', `Stand ${dateDe(today)}`]),
    row(['Name', ...sortedItems.map((i) => i.name), ...sortedItems.map((i) => `NEU ${i.name}`)]),
  ];
  for (const m of [...members].sort((a, b) => a.name.localeCompare(b.name, 'de'))) {
    const rec = byId.get(m.id);
    lines.push(
      row([
        m.name,
        ...sortedItems.map((i) => slotOf(rec, i.id).current),
        ...sortedItems.map((i) => wanted.get(`${m.id}:${i.id}`) ?? ''),
      ]),
    );
  }
  lines.push('', row(['Zu beschaffen gesamt']), row(['Kleidungsstück', 'Größe', 'Anzahl']));
  for (const { item, sizes } of totals(requests)) for (const s of sizes) lines.push(row([item.name, s.size, s.count]));
  // BOM, damit Excel UTF-8 (Umlaute) erkennt.
  return '﻿' + lines.join('\r\n');
}

/** Wer in die Kleidertabelle (PDF/CSV) kommt: alle aktiven Jugendlichen, dazu aktive Betreuer mit Einträgen. */
export function listedMembers(members: Member[], records: ClothingRecord[]): Member[] {
  const withData = new Set(records.filter((r) => Object.keys(r.items).length > 0).map((r) => r.id));
  return members.filter((m) => m.active && (m.kind === 'jugendlich' || withData.has(m.id)));
}

/** Anfrage für `POST /api/clothing/pdf` (Format wie `jf-hub-server/src/clothingPdf.ts`). */
export interface ClothingPdfRequest {
  date: string;
  items: string[];
  groups: { label: string; rows: { name: string; current: string[]; wanted: string[]; fresh: boolean[] }[] }[];
  totals: { item: string; sizes: SizeCount[] }[];
}

/**
 * Inhalt des PDFs für den Kleiderwart: Größenübersicht aller aufgeführten Mitglieder (Jugendliche, dann Betreuer)
 * und die Sammelliste. `requests` legt fest, welche Wünsche erscheinen; noch nicht weitergegebene gelten als neu.
 */
export function pdfRequest(members: Member[], records: ClothingRecord[], items: ClothingItem[], requests: OpenRequest[], today: string): ClothingPdfRequest {
  const sortedItems = [...items].sort((a, b) => a.order - b.order);
  const byId = new Map(records.map((r) => [r.id, r]));
  const wanted = new Map(requests.map((r) => [`${r.member.id}:${r.item.id}`, r.request]));
  const rowOf = (m: Member) => {
    const rec = byId.get(m.id);
    const req = sortedItems.map((i) => wanted.get(`${m.id}:${i.id}`));
    return {
      name: m.name,
      current: sortedItems.map((i) => slotOf(rec, i.id).current),
      wanted: req.map((r) => r?.size ?? ''),
      fresh: req.map((r) => !!r && !r.passedOn),
    };
  };
  const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const groups = [
    { label: 'Jugendliche', rows: sorted.filter((m) => m.kind === 'jugendlich').map(rowOf) },
    { label: 'Betreuer', rows: sorted.filter((m) => m.kind === 'betreuer').map(rowOf) },
  ].filter((g) => g.rows.length);
  return {
    date: today,
    items: sortedItems.map((i) => i.name),
    groups,
    totals: totals(requests).map(({ item, sizes }) => ({ item: item.name, sizes })),
  };
}
