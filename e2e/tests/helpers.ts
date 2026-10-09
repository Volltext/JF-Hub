import { execFileSync } from 'node:child_process';
import { expect, type APIRequestContext, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test';

export const ADMIN = { username: 'admin', password: 'e2e-admin-passwort' };
export const BEN = { username: 'ben', password: 'ben-hat-ein-passwort' };
/** Direkte Anfragen an den Abgleich melden das Dokumentformat wie die App (ohne Angabe gilt eine Anfrage als Version 2.0.x und wird abgewiesen). */
export const SCHEMA = { 'X-JFH-Schema': '4' };

/** Ein 1×1-Pixel-PNG: Die App macht daraus ein verkleinertes JPEG. */
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export type Who = { username: string; password: string };

/** Der Text eines PDFs, oder null, wenn `pdftotext` (poppler) auf diesem Rechner fehlt. */
export function pdfText(pdf: Buffer): string | null {
  try {
    return execFileSync('pdftotext', ['-', '-'], { input: pdf, maxBuffer: 10_000_000 }).toString('utf8');
  } catch {
    return null;
  }
}

/** Ein Anmelde-Token je Test-Datei (die Anmeldung ist je Adresse begrenzt, und jede Datei hat ihren eigenen Server). */
export function adminTokens(): (request: APIRequestContext) => Promise<string> {
  let cached: string | undefined;
  return async (request) => {
    if (!cached) {
      const login = await request.post('/api/login', { data: ADMIN });
      expect(login.ok()).toBeTruthy();
      cached = (await login.json()).token as string;
    }
    return cached;
  };
}

/** Admin legt Ben per API an (falls es ihn noch nicht gibt); Ben löst die Einladung ein. */
export async function createBen(request: APIRequestContext, token: string) {
  const auth = { Authorization: `Bearer ${token}` };
  const users = (await (await request.get('/api/admin/users', { headers: auth })).json()) as { username: string }[];
  if (users.some((u) => u.username === BEN.username)) return;
  const created = await request.post('/api/admin/users', { headers: auth, data: { username: BEN.username, displayName: 'Ben', role: 'betreuer' } });
  expect(created.ok()).toBeTruthy();
  const { invite } = await created.json();
  const accepted = await request.post('/api/invite/accept', { data: { username: BEN.username, code: invite.code, password: BEN.password } });
  expect(accepted.ok()).toBeTruthy();
}

export async function signIn(page: Page, who: Who) {
  await page.goto('/');
  await page.getByLabel('Benutzername').fill(who.username);
  await page.getByLabel('Passwort', { exact: true }).fill(who.password);
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('navigation', { name: /Hauptnavigation|Bereiche/ }).first()).toBeVisible();
}

/**
 * Die Anmeldung ist je Adresse auf 8 Versuche in 15 Minuten begrenzt, ein Test pro Anmeldung ließe das Limit schnell reißen.
 * Das Ergebnis meldet jede Person nur einmal über die Oberfläche an und gibt danach jedem Test einen frischen Browser mit derselben
 * Sitzung (Token und der lokale Zustand direkt nach der Anmeldung; was ein früherer Test geschrieben hat, kommt über den Abgleich).
 */
export function sessions(): (browser: Browser, who: Who, options?: BrowserContextOptions) => Promise<{ context: BrowserContext; page: Page }> {
  const saved = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();
  return async (browser, who, options = {}) => {
    let storageState = saved.get(who.username);
    if (!storageState) {
      const first = await browser.newContext();
      await signIn(await first.newPage(), who);
      storageState = await first.storageState({ indexedDB: true });
      await first.close();
      saved.set(who.username, storageState);
    }
    const context = await browser.newContext({ ...options, storageState });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: /Hauptnavigation|Bereiche/ }).first()).toBeVisible();
    return { context, page };
  };
}

/** Stößt den Abgleich über das Sync-Symbol an und wartet auf die Antwort des Servers. */
export async function syncNow(page: Page) {
  const badge = page.getByRole('button', { name: /^Server-Abgleich/ }).first();
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/sync') && r.request().method() === 'POST'), badge.click()]);
}

export async function writeProtocol(page: Page, title: string, text: string) {
  await page.goto('/#/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll' }).click();
  await page.getByLabel('Titel', { exact: true }).fill(title);
  await page.getByLabel('Protokolltext').click();
  await page.keyboard.type(text);
  await expect(page.getByText('Gespeichert')).toBeVisible();
}

/** Das Protokoll mit diesem Titel, wie der Server es gerade hat. */
export async function serverDoc(request: APIRequestContext, token: string, title: string) {
  const r = await request.post('/api/sync', { headers: { Authorization: `Bearer ${token}`, ...SCHEMA }, data: { since: 0, changes: [] } });
  const res = (await r.json()) as { changes: { id: string; title: string; rev: number; updatedAt: number; deleted: boolean; content: unknown }[] };
  return res.changes.find((c) => c.title === title);
}
