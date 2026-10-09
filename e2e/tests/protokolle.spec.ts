import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

// Eigener Server (siehe playwright.config.ts), damit die Anmeldungen dieser Tests das Anmelde-Limit des Rauchtests nicht aufbrauchen.
test.use({ baseURL: 'http://127.0.0.1:8096' });

const ADMIN = { username: 'admin', password: 'e2e-admin-passwort' };
const BEN = { username: 'ben', password: 'ben-hat-ein-passwort' };

async function adminToken(request: APIRequestContext): Promise<string> {
  const login = await request.post('/api/login', { data: ADMIN });
  expect(login.ok()).toBeTruthy();
  return (await login.json()).token as string;
}

/** Admin legt Ben per API an; Ben löst die Einladung ein. */
async function createBen(request: APIRequestContext) {
  const auth = { Authorization: `Bearer ${await adminToken(request)}` };
  const created = await request.post('/api/admin/users', { headers: auth, data: { username: BEN.username, displayName: 'Ben', role: 'betreuer' } });
  expect(created.ok()).toBeTruthy();
  const { invite } = await created.json();
  const accepted = await request.post('/api/invite/accept', { data: { username: BEN.username, code: invite.code, password: BEN.password } });
  expect(accepted.ok()).toBeTruthy();
}

async function signIn(page: Page, who: { username: string; password: string }) {
  await page.goto('/');
  await page.getByLabel('Benutzername').fill(who.username);
  await page.getByLabel('Passwort', { exact: true }).fill(who.password);
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('navigation', { name: /Hauptnavigation|Bereiche/ }).first()).toBeVisible();
}

async function newSession(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

/** Stößt den Abgleich über das Sync-Symbol an und wartet auf die Antwort des Servers. */
async function syncNow(page: Page) {
  const badge = page.getByRole('button', { name: /^Server-Abgleich/ }).first();
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/sync') && r.request().method() === 'POST'), badge.click()]);
}

async function writeProtocol(page: Page, title: string, text: string) {
  await page.goto('/#/protokolle');
  await page.getByRole('button', { name: 'Neues Protokoll' }).click();
  await page.getByLabel('Titel', { exact: true }).fill(title);
  await page.getByLabel('Protokolltext').click();
  await page.keyboard.type(text);
  await expect(page.getByText('Gespeichert')).toBeVisible();
}

/** Das Protokoll mit diesem Titel, wie der Server es gerade hat. */
async function serverDoc(request: APIRequestContext, token: string, title: string) {
  const r = await request.post('/api/sync', { headers: { Authorization: `Bearer ${token}` }, data: { since: 0, changes: [] } });
  const res = (await r.json()) as { changes: { title: string; rev: number; updatedAt: number; deleted: boolean }[] };
  return res.changes.find((c) => c.title === title);
}

test.describe.serial('Protokolle: Fundament', () => {
  test('Öffnen und Zurück verändert ein Protokoll nicht', async ({ browser, request }) => {
    const title = 'Nur zum Lesen';
    const token = await adminToken(request);
    const { context, page } = await newSession(browser);
    await signIn(page, ADMIN);
    await writeProtocol(page, title, 'Dieser Text bleibt unberührt.');
    await syncNow(page);
    const before = await serverDoc(request, token, title);
    expect(before).toBeTruthy();

    // Liste öffnen, Protokoll öffnen, wieder zurück.
    await page.getByRole('link', { name: /Protokolle/ }).first().click();
    await page.getByText(title).click();
    await expect(page.getByLabel('Protokolltext')).toContainText('Dieser Text bleibt unberührt.');
    await page.getByRole('link', { name: /Protokolle/ }).first().click();
    await syncNow(page); // schickt alles, was als geändert vorgemerkt wäre

    const after = await serverDoc(request, token, title);
    expect(after!.rev).toBe(before!.rev);
    expect(after!.updatedAt).toBe(before!.updatedAt);
    await context.close();
  });

  test('Gelöschtes Protokoll liegt im Papierkorb und lässt sich zurückholen', async ({ browser }) => {
    const title = 'Aus Versehen gelöscht';
    const { context, page } = await newSession(browser);
    await signIn(page, ADMIN);
    await writeProtocol(page, title, 'Wichtiger Inhalt.');
    await syncNow(page); // erst was der Server kennt, landet im Papierkorb

    await page.getByRole('button', { name: 'Protokoll löschen' }).click();
    await page.getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Protokolle' })).toBeVisible();
    await expect(page.getByText(title)).toBeHidden();
    await syncNow(page);

    await page.getByRole('link', { name: 'Papierkorb' }).click();
    await expect(page.getByRole('heading', { name: 'Papierkorb' })).toBeVisible();
    const row = page.locator('.item').filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText('noch 30 Tage');
    await page.screenshot({ path: 'test-results/papierkorb.png', fullPage: true });

    await row.getByRole('button', { name: 'Zurückholen' }).click();
    await expect(page.getByLabel('Titel', { exact: true })).toHaveValue(title);
    await expect(page.getByLabel('Protokolltext')).toContainText('Wichtiger Inhalt.');
    await context.close();
  });

  test('Gleichzeitiges Bearbeiten: Hinweis und Kopie statt stillem Verlust', async ({ browser, request }) => {
    const title = 'Betreuerbesprechung live';
    await createBen(request);

    const admin = await newSession(browser);
    await signIn(admin.page, ADMIN);
    await writeProtocol(admin.page, title, 'Ausgangstext.');
    await admin.page.getByRole('button', { name: 'Sichtbarkeit: privat' }).click();
    await admin.page.getByRole('button', { name: 'Für alle Betreuer veröffentlichen' }).click();
    await expect(admin.page.getByRole('button', { name: 'Sichtbarkeit: für alle Betreuer' })).toBeVisible();
    await syncNow(admin.page);

    const ben = await newSession(browser);
    await signIn(ben.page, BEN);
    await ben.page.goto('/#/protokolle');
    await ben.page.getByText(title).click({ timeout: 30_000 });
    await expect(ben.page.getByLabel('Protokolltext')).toContainText('Ausgangstext.');

    // Ben schreibt ohne Netz weiter, der Admin gleichzeitig mit Netz.
    await ben.context.setOffline(true);
    await ben.page.getByLabel('Protokolltext').click();
    await ben.page.keyboard.press('Control+End');
    await ben.page.keyboard.type(' Bens Ergänzung.');
    await expect(ben.page.getByText('Gespeichert')).toBeVisible();

    await admin.page.getByLabel('Protokolltext').click();
    await admin.page.keyboard.press('Control+End');
    await admin.page.keyboard.type(' Ergänzung des Admins.');
    await expect(admin.page.getByText('Gespeichert')).toBeVisible();
    await syncNow(admin.page);

    // Ben ist wieder online: sein Gerät übernimmt die Fassung des Servers und sagt, wo seine liegt.
    await ben.context.setOffline(false);
    await syncNow(ben.page);
    const notice = ben.page.getByRole('status').filter({ hasText: 'zur selben Zeit von jemand anderem geändert' });
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(ben.page.getByLabel('Protokolltext')).toContainText('Ergänzung des Admins.');
    await ben.page.screenshot({ path: 'test-results/konflikt-hinweis.png', fullPage: true });

    await notice.getByRole('link', { name: 'Kopie öffnen' }).click();
    await expect(ben.page.getByLabel('Titel', { exact: true })).toHaveValue(`${title} (Konflikt)`);
    await expect(ben.page.getByLabel('Protokolltext')).toContainText('Bens Ergänzung.');
    await expect(ben.page.getByRole('status').filter({ hasText: 'Das ist deine Fassung' })).toBeVisible();

    await admin.context.close();
    await ben.context.close();
  });
});

/** Dieselbe Adresse, aber mit kodiertem ersten Zeichen im `segment`-ten Teil des Pfads (Zählung ab 1, wie `split('/')`). */
function respelled(path: string, segment: number): string {
  return path
    .split('/')
    .map((s, i) => (i === segment && s ? `%${s.charCodeAt(0).toString(16)}${s.slice(1)}` : s))
    .join('/');
}

test.describe('Server: Zugriffsschutz', () => {
  test('geschützte Routen sind in jeder Schreibweise des Pfads geschützt', async ({ request }) => {
    // Gegen den echten HTTP-Stack, nicht nur gegen app.inject.
    for (const path of [respelled('/api/admin/backup', 1), respelled('/api/admin/info', 1), respelled('/api/admin/users', 2), respelled('/api/export.zip', 1)]) {
      const r = await request.get(path);
      expect(r.status(), path).toBe(400);
    }
    expect((await request.get('/api/admin/backup')).status()).toBe(401);
  });
});
