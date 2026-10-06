import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

const ADMIN = { username: 'admin', password: 'e2e-admin-passwort' };
const ANNA = { username: 'anna', password: 'anna-hat-ein-passwort' };
const TITLE = 'Dienst am 14. Oktober';

/** Admin legt Anna per API an; Anna löst die Einladung ein (der Einladungsweg selbst ist in den Server-Tests abgedeckt). */
async function createAnna(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: ADMIN });
  expect(login.ok()).toBeTruthy();
  const { token } = await login.json();
  const auth = { Authorization: `Bearer ${token}` };
  const created = await request.post('/api/admin/users', { headers: auth, data: { username: ANNA.username, displayName: 'Anna', role: 'betreuer' } });
  expect(created.ok()).toBeTruthy();
  const { invite } = await created.json();
  const accepted = await request.post('/api/invite/accept', { data: { username: ANNA.username, code: invite.code, password: ANNA.password } });
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

test.describe.serial('JF Hub Rauchtest', () => {
  test('Server liefert App, Service Worker und Admin-Oberfläche', async ({ request }) => {
    expect((await request.get('/api/health')).ok()).toBeTruthy();
    expect(await (await request.get('/api/status')).json()).toMatchObject({ setupRequired: false });
    expect(await (await request.get('/')).text()).toContain('<title>JF Hub');
    expect(await (await request.get('/sw.js')).text()).toContain('PRECACHE');
    expect(await (await request.get('/admin/')).text()).toContain('JF Hub');
  });

  test('falsches Passwort wird abgelehnt', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Benutzername').fill(ADMIN.username);
    await page.getByLabel('Passwort', { exact: true }).fill('falsch-falsch-falsch');
    await page.locator('button[type=submit]').click();
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('Protokoll schreiben, veröffentlichen, bei anderem Betreuer sehen', async ({ browser, request }) => {
    await createAnna(request);

    const admin = await newSession(browser);
    await signIn(admin.page, ADMIN);
    await admin.page.goto('/#/protokolle');
    await admin.page.getByRole('button', { name: 'Neues Protokoll' }).click();
    await admin.page.getByLabel('Titel', { exact: true }).fill(TITLE);
    await admin.page.getByLabel('Protokolltext').click();
    await admin.page.keyboard.type('Knoten geübt, Fahrzeugkunde wiederholt.');
    await expect(admin.page.getByText('Gespeichert')).toBeVisible();

    // Zuerst privat: Anna sieht nichts.
    await admin.page.getByRole('button', { name: 'Sichtbarkeit: privat' }).click();
    await admin.page.getByRole('button', { name: 'Für alle Betreuer veröffentlichen' }).click();
    await expect(admin.page.getByRole('button', { name: 'Sichtbarkeit: für alle Betreuer' })).toBeVisible();
    await expect(admin.page.getByText('Gespeichert')).toBeVisible();

    const anna = await newSession(browser);
    await signIn(anna.page, ANNA);
    await anna.page.goto('/#/protokolle');
    await expect(anna.page.getByText(TITLE)).toBeVisible({ timeout: 30_000 });

    // Zurücknehmen: das Protokoll verschwindet wieder bei Anna.
    await admin.page.getByRole('button', { name: 'Sichtbarkeit: für alle Betreuer' }).click();
    await admin.page.getByRole('button', { name: 'Wieder privat machen' }).click();
    await expect(admin.page.getByRole('button', { name: 'Sichtbarkeit: privat' })).toBeVisible();
    // Der Abgleich läuft beim Start der App; ein Neuladen holt den Löschhinweis sofort.
    await expect(async () => {
      await anna.page.reload();
      await expect(anna.page.getByRole('heading', { name: 'Protokolle' })).toBeVisible();
      await expect(anna.page.getByText(TITLE)).toBeHidden({ timeout: 3_000 });
    }).toPass({ timeout: 40_000 });

    await admin.context.close();
    await anna.context.close();
  });
});
