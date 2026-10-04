import { describe, expect, it } from 'vitest';
import type { Member } from '@/core/domain/types';
import { DEFAULT_ITEMS, byMember, exportCsv, exportText, listedMembers, nextRequestSize, openRequests, parseSizes, pdfRequest, stepSize, totals, type ClothingRecord } from './model';

const [jacke, hose, regen, handschuhe] = DEFAULT_ITEMS as [typeof DEFAULT_ITEMS[0], typeof DEFAULT_ITEMS[0], typeof DEFAULT_ITEMS[0], typeof DEFAULT_ITEMS[0]];
const member = (id: string, name: string, over: Partial<Member> = {}): Member => ({ id, name, kind: 'jugendlich', active: true, ...over });
const req = (size: string, passedOn: string | null = null) => ({ size, requestedAt: '2026-10-04', passedOn });

describe('Größenreihe', () => {
  it('findet die nächste Größe, auch über Kinder- und Herrengrößen hinweg', () => {
    expect(stepSize(jacke, '52', 1)).toBe('54');
    expect(stepSize(jacke, '158', 1)).toBe('164');
    expect(stepSize(jacke, '176', 1)).toBe('44');
    expect(stepSize(regen, 'S', -1)).toBe('XS');
    expect(stepSize(handschuhe, '12', 1)).toBeNull();
    expect(stepSize(regen, '165 / XS', 1)).toBeNull();
  });

  it('„eine größer“ geht von einem schon vorgemerkten Wunsch aus', () => {
    expect(nextRequestSize(jacke, { current: '52', request: null })).toBe('54');
    expect(nextRequestSize(jacke, { current: '52', request: req('54') })).toBe('56');
    expect(nextRequestSize(jacke, { current: '', request: null })).toBeNull();
  });

  it('liest eine Größenliste aus der Eingabe', () => {
    expect(parseSizes(' 128, 134;140\n140 , ,S ')).toEqual(['128', '134', '140', 'S']);
  });
});

describe('Beschaffung', () => {
  const members = [member('m2', 'Justus'), member('m1', 'Elias'), member('m3', 'Weg', { active: false })];
  const records: ClothingRecord[] = [
    { id: 'm1', items: { 'kombi-jacke': { current: '52', request: req('56') }, regenjacke: { current: 'S', request: req('M', '2026-09-01') } } },
    { id: 'm2', items: { 'kombi-jacke': { current: '56', request: req('58') }, 'kombi-hose': { current: '50', request: req('52') }, handschuhe: { current: '8', request: null } } },
    { id: 'm3', items: { 'kombi-jacke': { current: '50', request: req('52') } } },
  ];
  const requests = openRequests(members, records, DEFAULT_ITEMS);

  it('listet offene Wünsche aktiver Mitglieder nach Name und Kleidungsstück', () => {
    expect(requests.map((r) => `${r.member.name}:${r.item.id}:${r.request.size}`)).toEqual([
      'Elias:kombi-jacke:56',
      'Elias:regenjacke:M',
      'Justus:kombi-jacke:58',
      'Justus:kombi-hose:52',
    ]);
    expect(byMember(requests).map((g) => [g.member.name, g.requests.length])).toEqual([
      ['Elias', 2],
      ['Justus', 2],
    ]);
  });

  it('zählt je Kleidungsstück und Größe in der Reihenfolge der Größenreihe', () => {
    const more = [...requests, { ...requests[2]!, member: member('m4', 'Bo'), request: req('54') }];
    expect(totals(more).map((t) => [t.item.name, t.sizes.map((s) => `${s.count}×${s.size}`)])).toEqual([
      ['Kombi-Jacke', ['1×54', '1×56', '1×58']],
      ['Kombi-Hose', ['1×52']],
      ['Regenjacke', ['1×M']],
    ]);
  });

  it('erzeugt die Nachricht für den Kleiderwart', () => {
    const text = exportText(requests, '2026-10-04');
    expect(text).toContain('Stand: 04.10.2026');
    expect(text).toContain('Gesamt (4 Teile)');
    expect(text).toContain('• Kombi-Jacke: 1× 56, 1× 58');
    expect(text).toContain('Justus\n  – Kombi-Jacke: 58 (bisher 56)\n  – Kombi-Hose: 52 (bisher 50)');
    expect(exportText([], '2026-10-04')).toContain('nichts benötigt');
  });

  it('stellt das PDF für den Kleiderwart zusammen: Jugendliche, dann Betreuer mit Einträgen; neu = noch nicht weitergegeben', () => {
    const all = [...members, member('b1', 'Anna Betreuerin', { kind: 'betreuer' }), member('b2', 'Ohne Daten', { kind: 'betreuer' })];
    const recs = [...records, { id: 'b1', items: { handschuhe: { current: '9', request: null } } }];
    const listed = listedMembers(all, recs);
    expect(listed.map((m) => m.name)).toEqual(['Justus', 'Elias', 'Anna Betreuerin']);

    const req = pdfRequest(listed, recs, DEFAULT_ITEMS, openRequests(listed, recs, DEFAULT_ITEMS), '2026-10-04');
    expect(req.items).toEqual(['Kombi-Jacke', 'Kombi-Hose', 'Regenjacke', 'Handschuhe']);
    expect(req.groups.map((g) => [g.label, g.rows.map((r) => r.name)])).toEqual([
      ['Jugendliche', ['Elias', 'Justus']],
      ['Betreuer', ['Anna Betreuerin']],
    ]);
    expect(req.groups[0]!.rows[0]).toEqual({ name: 'Elias', current: ['52', '', 'S', ''], wanted: ['56', '', 'M', ''], fresh: [true, false, false, false] });
    expect(req.totals[0]).toEqual({ item: 'Kombi-Jacke', sizes: [{ size: '56', count: 1 }, { size: '58', count: 1 }] });
  });

  it('baut die Excel-Tabelle wie die bisherige Liste auf (aktuell links, NEU rechts)', () => {
    const csv = exportCsv(members.filter((m) => m.active), records, [jacke, hose], requests, '2026-10-04');
    const lines = csv.replace('﻿', '').split('\r\n');
    expect(lines[1]).toBe('Name;Kombi-Jacke;Kombi-Hose;NEU Kombi-Jacke;NEU Kombi-Hose');
    expect(lines[2]).toBe('Elias;52;;56;');
    expect(lines[3]).toBe('Justus;56;50;58;52');
    expect(lines).toContain('Kombi-Jacke;58;1');
  });
});
