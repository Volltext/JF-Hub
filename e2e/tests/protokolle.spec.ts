import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

// Eigener Server (siehe playwright.config.ts), damit die Anmeldungen dieser Tests das Anmelde-Limit des Rauchtests nicht aufbrauchen.
test.use({ baseURL: 'http://127.0.0.1:8096' });

const ADMIN = { username: 'admin', password: 'e2e-admin-passwort' };
/** Direkte Anfragen an den Abgleich melden das Dokumentformat wie die App (ohne Angabe gilt eine Anfrage als Version 2.0.x und wird abgewiesen). */
const SCHEMA = { 'X-JFH-Schema': '4' };
const BEN = { username: 'ben', password: 'ben-hat-ein-passwort' };

/** Ein Anmelde-Token für alle Tests (die Anmeldung ist je Adresse begrenzt). */
let cachedToken: string | undefined;
async function adminToken(request: APIRequestContext): Promise<string> {
  if (!cachedToken) {
    const login = await request.post('/api/login', { data: ADMIN });
    expect(login.ok()).toBeTruthy();
    cachedToken = (await login.json()).token as string;
  }
  return cachedToken;
}

/** Admin legt Ben per API an (falls es ihn noch nicht gibt); Ben löst die Einladung ein. */
async function createBen(request: APIRequestContext) {
  const auth = { Authorization: `Bearer ${await adminToken(request)}` };
  const users = (await (await request.get('/api/admin/users', { headers: auth })).json()) as { username: string }[];
  if (users.some((u) => u.username === BEN.username)) return;
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
  const r = await request.post('/api/sync', { headers: { Authorization: `Bearer ${token}`, ...SCHEMA }, data: { since: 0, changes: [] } });
  const res = (await r.json()) as { changes: { title: string; rev: number; updatedAt: number; deleted: boolean; content: unknown }[] };
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

test.describe.serial('Protokolle: Schutz vor unbekannten Inhalten', () => {
  test('Ein Protokoll mit Elementen aus einer neueren Version wird nur gelesen und nie überschrieben', async ({ browser, request }) => {
    const title = 'Mit Hinweisfeld aus der Zukunft';
    const token = await adminToken(request);
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    // „callout“ kennt keine App-Version (Tabellen, Links und Hervorhebung gibt es seit 2.3.0).
    const content = { type: 'doc', content: [p('Davor'), { type: 'callout', attrs: { tone: 'info' }, content: [p('Wichtiger Hinweis')] }, p('Danach')] };
    const sent = await request.post('/api/sync', {
      headers: { Authorization: `Bearer ${token}`, ...SCHEMA },
      data: { since: 0, changes: [{ id: 'zukunft-0001', baseRev: 0, title, datum: '2026-10-01', beginn: '', ende: '', ort: '', leitung: '', content, updatedAt: Date.now(), deleted: false }] },
    });
    expect(sent.ok()).toBeTruthy();
    const before = await serverDoc(request, token, title);
    expect(before).toBeTruthy();

    const { context, page } = await newSession(browser);
    await signIn(page, ADMIN);
    await page.goto('/#/protokolle');
    await page.getByText(title).click();
    await expect(page.getByRole('alert')).toContainText('Elemente, die diese App-Version nicht kennt');
    await expect(page.getByText('Wichtiger Hinweis')).toBeVisible(); // als Text lesbar
    await expect(page.getByLabel('Protokolltext', { exact: true })).toHaveCount(0); // aber kein Editor
    await page.screenshot({ path: 'test-results/unbekannte-elemente.png', fullPage: true });

    await page.getByRole('link', { name: /Protokolle/ }).first().click();
    await syncNow(page);
    const after = await serverDoc(request, token, title);
    expect(after!.rev).toBe(before!.rev);
    expect(after!.content).toEqual(content); // unverändert, das Hinweisfeld ist noch da
    await context.close();
  });
});

test.describe.serial('Protokolle: Tabellen, Links und Hervorhebung', () => {
  test('Tabelle, Link und Hervorhebung einfügen, speichern und im PDF finden', async ({ browser, request }) => {
    const title = 'Aufgaben mit Tabelle';
    const token = await adminToken(request);
    const { context, page } = await newSession(browser);
    await signIn(page, ADMIN);
    await writeProtocol(page, title, 'Aufgaben für den Herbst.');
    const editor = page.getByLabel('Protokolltext', { exact: true });
    // Links öffnen den Browser; hier wird nur aufgezeichnet, was geöffnet würde.
    await page.evaluate(() => {
      (window as unknown as { __opened: string[] }).__opened = [];
      window.open = (url) => {
        (window as unknown as { __opened: string[] }).__opened.push(String(url));
        return null;
      };
    });

    // Tabelle über Einfügen → Tabelle: 2 × 2 mit Kopfzeile, danach mit Tab durch die Zellen
    await page.getByRole('button', { name: 'Einfügen', exact: true }).click();
    await page.getByRole('dialog', { name: 'Einfügen' }).getByRole('button', { name: /^Tabelle/ }).click();
    await page.getByLabel(/^Zeilen/).fill('2');
    await page.getByLabel(/^Spalten/).fill('2');
    await page.getByRole('button', { name: 'Tabelle einfügen', exact: true }).click();
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('th')).toHaveCount(2);
    for (const cell of ['Wer', 'Aufgabe', 'Anna', 'Schläuche']) {
      await page.keyboard.type(cell);
      await page.keyboard.press('Tab');
    }
    // Tab in der letzten Zelle legt eine neue Zeile an und springt hinein
    await page.keyboard.type('Ben');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Material');
    await expect(editor.locator('tr')).toHaveCount(3);

    // Tabellen-Leiste: Zeile unten einfügen, wieder löschen, Kopfzeile aus- und einschalten
    const tableBar = page.getByRole('toolbar', { name: 'Tabelle' });
    await expect(tableBar).toBeVisible();
    await tableBar.getByRole('button', { name: 'Zeile unten einfügen' }).click();
    await expect(editor.locator('tr')).toHaveCount(4);
    await page.keyboard.press('Tab'); // in die neue Zeile
    await tableBar.getByRole('button', { name: 'Zeile löschen' }).click();
    await expect(editor.locator('tr')).toHaveCount(3);
    await expect(editor).toContainText('Material');
    await tableBar.getByRole('button', { name: 'Kopfzeile ein oder aus' }).click();
    await expect(editor.locator('th')).toHaveCount(0);
    await tableBar.getByRole('button', { name: 'Kopfzeile ein oder aus' }).click();
    await expect(editor.locator('th')).toHaveCount(2);

    // Hervorheben: das Wort in der letzten Zelle markieren
    await editor.getByText('Material', { exact: true }).click(); // der Absatz ist breiter als das Wort: Der Cursor landet am Zeilenende
    await page.keyboard.press('Shift+Home');
    await expect.poll(() => page.evaluate(() => String(getSelection()))).toBe('Material'); // erst weiter, wenn der Editor die Auswahl kennt
    await page.getByRole('button', { name: 'Hervorheben', exact: true }).click();
    await expect(editor.locator('mark')).toHaveText('Material');

    // Link: im ersten Absatz, danach weitertippen verlängert den Link nicht
    await editor.locator('p').first().click(); // rechts vom Text geklickt: Der Cursor steht am Zeilenende
    await page.keyboard.type(' Mehr unter ');
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    await page.getByLabel('Adresse').fill('beispiel.de');
    await page.getByLabel(/^Text/).fill('Webseite');
    await page.getByRole('button', { name: 'Link einfügen', exact: true }).click();
    await page.keyboard.type(' und mehr');
    const link = editor.locator('a');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText('Webseite');
    await expect(link).toHaveAttribute('href', 'https://beispiel.de');
    await expect(editor.locator('p').first()).toContainText('Mehr unter Webseite und mehr');

    // Ein Klick in den Link zeigt die Link-Leiste: Öffnen, Ändern, Entfernen
    await link.click();
    const linkBar = page.getByRole('toolbar', { name: 'Link' });
    await expect(linkBar).toContainText('beispiel.de');
    await linkBar.getByRole('button', { name: 'Öffnen' }).click();
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['https://beispiel.de']);
    await linkBar.getByRole('button', { name: 'Ändern' }).click();
    await expect(page.getByLabel('Adresse')).toHaveValue('https://beispiel.de');
    await page.getByLabel('Adresse').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.getByRole('alert')).toContainText('keine gültige Adresse'); // unzulässige Ziele werden abgelehnt
    await page.getByLabel('Adresse').fill('www.example.de/seite');
    await page.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(link).toHaveAttribute('href', 'https://www.example.de/seite');

    await expect(page.getByText('Gespeichert')).toBeVisible();
    await page.screenshot({ path: 'test-results/tabelle-link-marker.png', fullPage: true });
    await syncNow(page);

    // Auf dem Server liegen Tabelle, Link und Hervorhebung im Inhalt
    const doc = await serverDoc(request, token, title);
    const json = JSON.stringify(doc!.content);
    for (const part of ['"type":"table"', '"type":"tableHeader"', '"type":"tableCell"', '"type":"link"', '"type":"highlight"', 'https://www.example.de/seite']) expect(json, part).toContain(part);

    // Nach dem Neuladen ist alles noch da
    await page.reload();
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('mark')).toHaveText('Material');
    await expect(editor.locator('a')).toHaveAttribute('href', 'https://www.example.de/seite');

    // Das PDF enthält die Tabelle (Text) und den anklickbaren Link
    const pdf = await request.get(`/api/protocols/${(doc as unknown as { id: string }).id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    expect(pdf.status()).toBe(200);
    const bytes = (await pdf.body()).toString('latin1');
    expect(bytes.startsWith('%PDF-')).toBe(true);
    expect(bytes).toContain('https://www.example.de/seite');
    await context.close();
  });

  test('Foto und Trennlinie aus einer Tabellenzelle heraus landen hinter der Tabelle und zerteilen sie nicht', async ({ browser, request }) => {
    await adminToken(request);
    const { context, page } = await newSession(browser);
    await signIn(page, ADMIN);
    await writeProtocol(page, 'Foto neben Tabelle', 'Text.');
    const editor = page.getByLabel('Protokolltext', { exact: true });
    await page.getByRole('button', { name: 'Einfügen', exact: true }).click();
    await page.getByRole('dialog', { name: 'Einfügen' }).getByRole('button', { name: /^Tabelle/ }).click();
    await page.getByLabel(/^Zeilen/).fill('2');
    await page.getByLabel(/^Spalten/).fill('2');
    await page.getByRole('button', { name: 'Tabelle einfügen', exact: true }).click();
    await page.keyboard.type('Zelle'); // der Cursor steht in der ersten Zelle der ersten Zeile

    // Zellen nehmen nur Text und Listen auf. Ein Foto soll nicht verschwinden und die Tabelle nicht zerreißen, sondern dahinter stehen.
    await page.getByRole('button', { name: 'Foto oder Datei anhängen' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Foto aus Galerie/ }).click();
    await (await chooser).setFiles({ name: 'teich.png', mimeType: 'image/png', buffer: PNG_1X1 });
    await expect(editor.locator('.photo-node img')).toBeVisible();
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('table .photo-node')).toHaveCount(0);
    await expect(editor.locator('tr')).toHaveCount(2);

    // Dasselbe für die Trennlinie; Tabelle und Zitat gibt es in einer Tabelle nicht
    await editor.locator('td').first().click();
    await page.getByRole('button', { name: 'Einfügen', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Einfügen' });
    await expect(sheet.getByRole('button', { name: /^Tabelle/ })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: /^Zitat/ })).toHaveCount(0);
    await sheet.getByRole('button', { name: /^Trennlinie/ }).click();
    await expect(editor.locator('hr')).toHaveCount(1);
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('tr')).toHaveCount(2);
    await expect(editor.locator('table hr')).toHaveCount(0);
    await expect(editor.locator('table')).toContainText('Zelle');
    await context.close();
  });

  test('am Handy: Leiste, Tabelle und Link passen auf den Bildschirm', async ({ browser, request }) => {
    const title = 'Handy mit Tabelle';
    await adminToken(request);
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await signIn(page, ADMIN);
    await writeProtocol(page, title, 'Kurz.');
    const editor = page.getByLabel('Protokolltext', { exact: true });
    await page.getByRole('button', { name: 'Einfügen', exact: true }).tap();
    await page.getByRole('dialog', { name: 'Einfügen' }).getByRole('button', { name: /^Tabelle/ }).tap();
    await page.getByLabel(/^Spalten/).fill('6');
    await page.getByRole('button', { name: 'Tabelle einfügen', exact: true }).tap();
    await expect(editor.locator('th')).toHaveCount(6);
    await expect(page.getByRole('toolbar', { name: 'Tabelle' })).toBeVisible();
    // Sechs Spalten à mindestens 96 px sind breiter als der Bildschirm: Die Tabelle scrollt im Rahmen, die Seite nicht.
    const sizes = await page.evaluate(() => {
      const wrapper = document.querySelector('.tableWrapper') as HTMLElement;
      return { wrapperScrolls: wrapper.scrollWidth > wrapper.clientWidth, pageWidth: document.documentElement.scrollWidth, viewport: window.innerWidth };
    });
    expect(sizes.wrapperScrolls).toBe(true);
    expect(sizes.pageWidth).toBeLessThanOrEqual(sizes.viewport);
    await page.screenshot({ path: 'test-results/tabelle-am-handy.png' });
    await context.close();
  });
});

/** Dieselbe Adresse, aber mit kodiertem ersten Zeichen im `segment`-ten Teil des Pfads (Zählung ab 1, wie `split('/')`). */
function respelled(path: string, segment: number): string {
  return path
    .split('/')
    .map((s, i) => (i === segment && s ? `%${s.charCodeAt(0).toString(16)}${s.slice(1)}` : s))
    .join('/');
}

/** Ein 1×1-Pixel-PNG: Die App macht daraus ein verkleinertes JPEG. */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.describe.serial('Protokolle: Fotos als Anhänge', () => {
  test('Foto einfügen, hochladen, bei einem anderen Betreuer sehen und im PDF finden', async ({ browser, request }) => {
    const title = 'Teich mit Foto';
    const token = await adminToken(request);
    await createBen(request);

    const admin = await newSession(browser);
    await signIn(admin.page, ADMIN);
    await writeProtocol(admin.page, title, 'Text vor dem Foto.');
    await admin.page.getByRole('button', { name: 'Sichtbarkeit: privat' }).click();
    await admin.page.getByRole('button', { name: 'Für alle Betreuer veröffentlichen' }).click();
    await expect(admin.page.getByRole('button', { name: 'Sichtbarkeit: für alle Betreuer' })).toBeVisible();

    // Foto aus der Galerie: Die Auswahl öffnet die Dateiauswahl des Browsers.
    await admin.page.getByLabel('Protokolltext').click();
    await admin.page.getByRole('button', { name: 'Foto oder Datei anhängen' }).click();
    const chooser = admin.page.waitForEvent('filechooser');
    await admin.page.getByRole('button', { name: /Foto aus Galerie/ }).click();
    await (await chooser).setFiles({ name: 'teich.png', mimeType: 'image/png', buffer: PNG_1X1 });
    const photo = admin.page.locator('.photo-node img');
    await expect(photo).toBeVisible();
    await expect(admin.page.getByText('Gespeichert')).toBeVisible();
    await admin.page.screenshot({ path: 'test-results/foto-im-protokoll.png', fullPage: true });
    await syncNow(admin.page);

    // Auf dem Server liegt nur ein Verweis im Protokoll, das Bild als eigener Anhang.
    const doc = await serverDoc(request, token, title);
    expect(doc).toBeTruthy();
    const json = JSON.stringify(doc!.content);
    expect(json).not.toContain('data:image');
    const blobId = /"blobId":"([^"]+)"/.exec(json)?.[1];
    expect(blobId).toBeTruthy();
    const blob = await request.get(`/api/blobs/${blobId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(blob.status()).toBe(200);
    expect(blob.headers()['content-type']).toBe('image/jpeg');
    expect([...(await blob.body()).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

    // Das PDF enthält das Foto.
    const pdf = await request.get(`/api/protocols/${(doc as unknown as { id: string }).id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).toString('latin1')).toContain('/DCTDecode');

    // Ben sieht das Foto: Es wird beim Anschauen vom Server geholt.
    const ben = await newSession(browser);
    await signIn(ben.page, BEN);
    await ben.page.goto('/#/protokolle');
    await ben.page.getByText(title).click({ timeout: 30_000 });
    const benPhoto = ben.page.locator('.photo-node img');
    await expect(benPhoto).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => benPhoto.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await ben.page.screenshot({ path: 'test-results/foto-bei-ben.png', fullPage: true });

    // Anschauen verändert nichts: Das Protokoll mit Foto bleibt beim Server auf derselben Revision.
    await ben.page.getByRole('link', { name: /Protokolle/ }).first().click();
    await syncNow(ben.page);
    const after = await serverDoc(request, token, title);
    expect(after!.rev).toBe(doc!.rev);
    expect(after!.updatedAt).toBe(doc!.updatedAt);

    await admin.context.close();
    await ben.context.close();
  });
});

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
