import { expect, test, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { ADMIN, adminTokens, BEN, createBen, foreignParagraph, putForeignText, serverDoc, serverHasText, sessions, syncNow, writeProtocol } from './helpers';

// Eigener Server (siehe playwright.config.ts): Die Anmeldung ist je Adresse begrenzt, und jede Datei teilt sich die Anmeldungen ihrer Tests.
test.use({ baseURL: 'http://127.0.0.1:8094' });

const adminToken = adminTokens();
const open = sessions();
const editorOf = (page: Page) => page.getByLabel('Protokolltext', { exact: true });
const textOf = (page: Page) => editorOf(page).innerText();

/** Der Admin schreibt ein Protokoll und veröffentlicht es für alle Betreuer. */
async function publish(page: Page, title: string, text: string) {
  await writeProtocol(page, title, text);
  await page.getByRole('button', { name: 'Sichtbarkeit: privat' }).click();
  await page.getByRole('button', { name: 'Für alle Betreuer veröffentlichen' }).click();
  await expect(page.getByRole('button', { name: 'Sichtbarkeit: für alle Betreuer' })).toBeVisible();
}

async function openProtocol(page: Page, title: string) {
  await page.goto('/#/protokolle');
  await page.getByText(title).click({ timeout: 30_000 });
  await expect(editorOf(page)).toBeVisible();
}

async function append(page: Page, text: string) {
  await editorOf(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

test.describe.serial('Gemeinsam schreiben', () => {
  test('zwei Betreuer tippen gleichzeitig: beide Texte erscheinen bei beiden, die Mitschreibenden werden genannt', async ({ browser, request }) => {
    const title = 'Gemeinsame Sitzung';
    await createBen(request, await adminToken(request));
    const admin = await open(browser, ADMIN);
    const ben = await open(browser, BEN);
    await publish(admin.page, title, 'Ausgangstext.');
    await syncNow(admin.page);
    await openProtocol(ben.page, title);
    await expect(editorOf(ben.page)).toContainText('Ausgangstext.');

    await append(admin.page, ' Anna schreibt.');
    await append(ben.page, ' Ben schreibt.');
    for (const page of [admin.page, ben.page]) {
      await expect(editorOf(page)).toContainText('Anna schreibt.', { timeout: 30_000 });
      await expect(editorOf(page)).toContainText('Ben schreibt.', { timeout: 30_000 });
    }
    expect(await textOf(admin.page)).toBe(await textOf(ben.page));
    // Wer sonst noch am Protokoll sitzt, steht darüber
    await expect(admin.page.getByText('Ben ist auch hier')).toBeVisible({ timeout: 30_000 });
    await expect(ben.page.getByText('Admin ist auch hier')).toBeVisible({ timeout: 30_000 });
    await admin.page.screenshot({ path: 'test-results/gemeinsam-schreiben.png', fullPage: true });

    // keine Kopie, kein Hinweis auf einen Konflikt
    await expect(admin.page.getByText('zur selben Zeit von jemand anderem geändert')).toHaveCount(0);
    const token = await adminToken(request);
    const doc = await serverHasText(request, token, title, 'Ben schreibt.');
    expect(JSON.stringify(doc.content)).toContain('Anna schreibt.');
    await admin.context.close();
    await ben.context.close();
  });

  test('Ben schreibt ohne Netz weiter, Anna gleichzeitig mit Netz: beim Wiederverbinden bleibt beides, ohne „(Konflikt)“-Kopie', async ({ browser, request }) => {
    const title = 'Offline und online';
    const token = await adminToken(request);
    const admin = await open(browser, ADMIN);
    const ben = await open(browser, BEN);
    await publish(admin.page, title, 'Ausgangstext.');
    await syncNow(admin.page);
    await openProtocol(ben.page, title);
    await expect(editorOf(ben.page)).toContainText('Ausgangstext.');

    await ben.context.setOffline(true);
    await append(ben.page, ' Bens Ergänzung im Zug.');
    await expect(ben.page.getByText(/^Offline:/)).toBeVisible({ timeout: 30_000 });
    await append(admin.page, ' Annas Ergänzung im Büro.');
    await serverHasText(request, token, title, 'Annas Ergänzung im Büro.');

    await ben.context.setOffline(false);
    for (const page of [admin.page, ben.page]) {
      await expect(editorOf(page)).toContainText('Bens Ergänzung im Zug.', { timeout: 30_000 });
      await expect(editorOf(page)).toContainText('Annas Ergänzung im Büro.', { timeout: 30_000 });
    }
    expect(await textOf(admin.page)).toBe(await textOf(ben.page));
    await ben.page.getByRole('link', { name: /Protokolle/ }).first().click();
    await expect(ben.page.getByText(`${title} (Konflikt)`)).toHaveCount(0);
    await expect(ben.page.getByText('(lokale Fassung)')).toHaveCount(0);
    await admin.context.close();
    await ben.context.close();
  });

  test('ein Protokoll, das ohne Netz angelegt und geschrieben wurde, kommt beim Wiederverbinden mit seinem Text zum anderen', async ({ browser, request }) => {
    const title = 'Im Zug geschrieben';
    const token = await adminToken(request);
    const ben = await open(browser, BEN);
    await ben.context.setOffline(true);
    await writeProtocol(ben.page, title, 'Neuer Text ohne Netz.');
    await ben.page.getByRole('button', { name: 'Sichtbarkeit: privat' }).click();
    await ben.page.getByRole('button', { name: 'Für alle Betreuer veröffentlichen' }).click();
    await expect(ben.page.getByRole('button', { name: 'Sichtbarkeit: für alle Betreuer' })).toBeVisible();

    await ben.context.setOffline(false);
    const doc = await serverHasText(request, token, title, 'Neuer Text ohne Netz.', 60_000);
    expect(doc).toBeTruthy();
    const admin = await open(browser, ADMIN);
    await openProtocol(admin.page, title);
    await expect(editorOf(admin.page)).toContainText('Neuer Text ohne Netz.', { timeout: 30_000 });
    await admin.context.close();
    await ben.context.close();
  });

  const OPEN_SHAPES: { title: string; id: string; text: string; fill: (frag: Y.XmlFragment) => void }[] = [
    {
      title: 'Foto am Ende',
      id: 'foto-ende-0001',
      text: 'Siehe https://beispiel.de/seite',
      fill: (frag) => {
        const photo = new Y.XmlElement('photo');
        for (const [k, v] of Object.entries({ src: '', w: 8, h: 6, caption: '', blobId: 'gibt-es-nicht-1', mime: 'image/jpeg' })) photo.setAttribute(k, v as never);
        frag.insert(0, [foreignParagraph('Siehe https://beispiel.de/seite'), photo]);
      },
    },
    {
      // Eine Zeile mit zu wenigen Zellen: Die Reparatur von ProseMirror (`fixTables`) würde sie beim Öffnen ergänzen und dadurch schreiben.
      title: 'Unregelmäßige Tabelle am Ende',
      id: 'tabelle-ende-0001',
      text: 'Zelle A',
      fill: (frag) => {
        const cell = (text: string) => {
          const c = new Y.XmlElement('tableCell');
          c.setAttribute('colspan', 1 as never);
          c.setAttribute('rowspan', 1 as never);
          c.insert(0, [foreignParagraph(text)]);
          return c;
        };
        const row = (...cells: Y.XmlElement[]) => {
          const r = new Y.XmlElement('tableRow');
          r.insert(0, cells);
          return r;
        };
        const table = new Y.XmlElement('table');
        table.insert(0, [row(cell('Zelle A'), cell('Zelle B')), row(cell('Zelle C'))]);
        frag.insert(0, [foreignParagraph('vor der Tabelle'), table]);
      },
    },
  ];

  for (const shape of OPEN_SHAPES) {
    test(`Öffnen und Zurück verändert „${shape.title}“ nicht (nichts wird beim Laden ins Dokument geschrieben)`, async ({ browser, request }) => {
      const token = await adminToken(request);
      await putForeignText(request, token, shape.id, shape.title, shape.fill);
      const before = await serverDoc(request, token, shape.title);
      expect(before).toBeTruthy();

      const { context, page } = await open(browser, ADMIN);
      await openProtocol(page, shape.title);
      await expect(editorOf(page)).toContainText(shape.text);
      await expect(editorOf(page).locator('a')).toHaveCount(0); // die Adresse im ersten Protokoll wird beim Öffnen nicht still zum Link
      await editorOf(page).click({ position: { x: 5, y: 5 } }); // Cursor setzen, ohne zu tippen
      await page.waitForTimeout(7_000); // mehrere Runden des Austauschs bei geöffnetem Editor
      await page.getByRole('link', { name: /Protokolle/ }).first().click();
      await syncNow(page);

      const after = await serverDoc(request, token, shape.title);
      expect(after!.rev).toBe(before!.rev);
      expect(after!.updatedAt).toBe(before!.updatedAt);
      expect(JSON.stringify(after!.content)).toBe(JSON.stringify(before!.content));
      await context.close();
    });
  }

  test('wird die Datenbank des Servers ersetzt, während jemand schreibt, bleibt dessen ungesendeter Text als Kopie erhalten', async ({ browser, request }) => {
    const title = 'Wiederherstellung live';
    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    const admin = await open(browser, ADMIN);
    const ben = await open(browser, BEN);
    await publish(admin.page, title, 'Stand der Sicherung.');
    await syncNow(admin.page);
    await serverHasText(request, token, title, 'Stand der Sicherung.');
    await openProtocol(ben.page, title);
    await expect(editorOf(ben.page)).toContainText('Stand der Sicherung.');

    // Sicherung anlegen, danach wird weitergeschrieben
    const made = await request.post('/api/admin/backups', { headers: auth });
    expect(made.ok()).toBeTruthy();
    const backup = ((await made.json()) as { name: string }).name;
    await append(admin.page, ' Später dazugekommen.');
    await serverHasText(request, token, title, 'Später dazugekommen.');
    await expect(editorOf(ben.page)).toContainText('Später dazugekommen.', { timeout: 30_000 });

    // Ben schreibt ohne Netz; währenddessen wird die Sicherung eingespielt
    await ben.context.setOffline(true);
    await append(ben.page, ' Bens ungesendeter Satz.');
    await expect(ben.page.getByText(/^Offline:/)).toBeVisible({ timeout: 30_000 });
    const restored = await request.post(`/api/admin/backups/${backup}/restore`, { headers: auth });
    expect(restored.ok()).toBeTruthy();

    await ben.context.setOffline(false);
    await syncNow(ben.page);
    await ben.page.getByRole('link', { name: /Protokolle/ }).first().click();
    const copy = ben.page.getByText(`${title} (lokale Fassung)`);
    await expect(copy).toBeVisible({ timeout: 30_000 });
    await copy.click();
    await expect(editorOf(ben.page)).toContainText('Bens ungesendeter Satz.');

    // Das Original zeigt den Stand der Sicherung, ohne das später Dazugekommene
    await ben.page.getByRole('link', { name: /Protokolle/ }).first().click();
    await ben.page.getByText(title, { exact: true }).click();
    await expect(editorOf(ben.page)).toContainText('Stand der Sicherung.');
    await expect(editorOf(ben.page)).not.toContainText('Später dazugekommen.');
    await admin.context.close();
    await ben.context.close();
  });
});
