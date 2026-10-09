import { expect, test } from '@playwright/test';
import { ADMIN, adminTokens, BEN, createBen, PNG_1X1, SCHEMA, serverDoc, sessions, syncNow, writeProtocol } from './helpers';

// Eigener Server (siehe playwright.config.ts), damit die Anmeldungen dieser Tests das Anmelde-Limit des Rauchtests nicht aufbrauchen.
test.use({ baseURL: 'http://127.0.0.1:8096' });

const adminToken = adminTokens();
const open = sessions();

test.describe.serial('Protokolle: Fundament', () => {
  test('Öffnen und Zurück verändert ein Protokoll nicht', async ({ browser, request }) => {
    const title = 'Nur zum Lesen';
    const token = await adminToken(request);
    const { context, page } = await open(browser, ADMIN);
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
    const { context, page } = await open(browser, ADMIN);
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
    await createBen(request, await adminToken(request));

    const admin = await open(browser, ADMIN);
    await writeProtocol(admin.page, title, 'Ausgangstext.');
    await admin.page.getByRole('button', { name: 'Sichtbarkeit: privat' }).click();
    await admin.page.getByRole('button', { name: 'Für alle Betreuer veröffentlichen' }).click();
    await expect(admin.page.getByRole('button', { name: 'Sichtbarkeit: für alle Betreuer' })).toBeVisible();
    await syncNow(admin.page);

    const ben = await open(browser, BEN);
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

    const { context, page } = await open(browser, ADMIN);
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

/** Dieselbe Adresse, aber mit kodiertem ersten Zeichen im `segment`-ten Teil des Pfads (Zählung ab 1, wie `split('/')`). */
function respelled(path: string, segment: number): string {
  return path
    .split('/')
    .map((s, i) => (i === segment && s ? `%${s.charCodeAt(0).toString(16)}${s.slice(1)}` : s))
    .join('/');
}

test.describe.serial('Protokolle: Fotos als Anhänge', () => {
  test('Foto einfügen, hochladen, bei einem anderen Betreuer sehen und im PDF finden', async ({ browser, request }) => {
    const title = 'Teich mit Foto';
    const token = await adminToken(request);
    await createBen(request, token);

    const admin = await open(browser, ADMIN);
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
    const pdf = await request.get(`/api/protocols/${doc!.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).toString('latin1')).toContain('/DCTDecode');

    // Ben sieht das Foto: Es wird beim Anschauen vom Server geholt.
    const ben = await open(browser, BEN);
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
