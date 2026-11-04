import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

const ADMIN = { username: 'admin', password: 'e2e-admin-passwort' };
const TOBIAS = { username: 'tobias', password: 'tobias-hat-ein-passwort' };

/** Admin legt Tobias per API an (falls es ihn noch nicht gibt); Tobias löst die Einladung ein. */
async function ensureTobias(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: ADMIN });
  expect(login.ok()).toBeTruthy();
  const auth = { Authorization: `Bearer ${(await login.json()).token}` };
  const created = await request.post('/api/admin/users', { headers: auth, data: { username: TOBIAS.username, displayName: 'Tobias', role: 'betreuer' } });
  if (created.status() === 409) return;
  expect(created.ok()).toBeTruthy();
  const { invite } = await created.json();
  const accepted = await request.post('/api/invite/accept', { data: { username: TOBIAS.username, code: invite.code, password: TOBIAS.password } });
  expect(accepted.ok()).toBeTruthy();
}

async function openStoppuhr(browser: Browser, who: { username: string; password: string }): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.getByLabel('Benutzername').fill(who.username);
  await page.getByLabel('Passwort', { exact: true }).fill(who.password);
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('navigation', { name: /Hauptnavigation|Bereiche/ }).first()).toBeVisible();
  await page.goto('/#/wettkampf');
  await expect(page.getByText('● Live')).toBeVisible();
  return page;
}

/** Angezeigte Zeit „mm:ss,d“ in Sekunden. */
async function shownSeconds(page: Page): Promise<number> {
  const [mm, rest] = (await page.locator('.clock').innerText()).split(':');
  const [ss, tenth] = rest!.split(',');
  return Number(mm) * 60 + Number(ss) + Number(tenth) / 10;
}

test('Live-Stoppuhr: zwei Betreuer sehen dieselbe Stoppuhr', async ({ browser, request }) => {
  await ensureTobias(request);
  const admin = await openStoppuhr(browser, ADMIN);
  const tobias = await openStoppuhr(browser, TOBIAS);

  // Admin startet, bei Tobias läuft die Uhr mit derselben Zeit.
  await admin.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(tobias.getByRole('button', { name: 'Stopp', exact: true })).toBeVisible();
  await expect(tobias.getByText('zuletzt geändert von Admin')).toBeVisible();
  await expect(async () => expect(await shownSeconds(tobias)).toBeGreaterThan(1)).toPass();
  const [a, t] = await Promise.all([shownSeconds(admin), shownSeconds(tobias)]);
  expect(Math.abs(a - t)).toBeLessThan(0.5);

  // Tobias stoppt, beim Admin steht dieselbe Zeit.
  await tobias.getByRole('button', { name: 'Stopp', exact: true }).click();
  await expect(admin.getByRole('button', { name: 'Weiter', exact: true })).toBeVisible();
  await expect(admin.locator('.clock')).toHaveText(await tobias.locator('.clock').innerText());

  // Notizen und Wertung kommen ebenfalls an.
  await admin.getByPlaceholder('Was lief gut, was nicht?').fill('Kupplung am Verteiler klemmt');
  await expect(tobias.getByPlaceholder('Was lief gut, was nicht?')).toHaveValue('Kupplung am Verteiler klemmt');
  await tobias.getByRole('button', { name: /Wettkampf-Wertung mitführen/ }).click();
  await expect(admin.getByRole('button', { name: /Wettkampf-Wertung mitführen/ })).toHaveAttribute('aria-pressed', 'true');

  // Tobias speichert den Lauf: bei beiden ist die Stoppuhr danach frei für den nächsten.
  await tobias.getByRole('button', { name: 'Lauf speichern' }).click();
  await expect(tobias.getByText('Lauf gespeichert ✓')).toBeVisible();
  await expect(admin.locator('.clock')).toHaveText('00:00,0');
  await expect(admin.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(admin.getByPlaceholder('Was lief gut, was nicht?')).toHaveValue('');

  // Läuft die Stoppuhr in einem anderen Modus, zeigt die App das an und wechselt auf Wunsch dorthin.
  await tobias.getByRole('button', { name: 'B', exact: true }).click();
  await tobias.getByRole('button', { name: 'Start', exact: true }).click();
  await admin.getByRole('button', { name: /Stoppuhr läuft gerade: B-Teil/ }).click();
  await expect(admin.getByRole('button', { name: 'B', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(admin.getByRole('button', { name: 'Stopp', exact: true })).toBeVisible();
  await admin.getByRole('button', { name: 'Stopp', exact: true }).click();
  await expect(tobias.getByRole('button', { name: 'Weiter', exact: true })).toBeVisible();
});
