import { expect, test } from '@playwright/test';

/** Demo im Browser, ausgeliefert wie auf GitHub Pages unter einem Unterpfad (siehe playwright.config.ts). */
const DEMO = 'http://127.0.0.1:8097/JF-Hub/demo/';

test.describe('Demo im Browser (ohne Server)', () => {
  test('startet ohne Anmeldung mit Beispieldaten und fragt nirgendwo anders an', async ({ page }) => {
    const foreign: string[] = [];
    const failed: string[] = [];
    page.on('request', (r) => {
      if (!r.url().startsWith(DEMO)) foreign.push(r.url());
    });
    page.on('response', (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });

    await page.goto(DEMO);
    await expect(page.getByRole('note')).toContainText('Demo im Browser');
    await expect(page.getByText('Anmeldung Kreiszeltlager abschicken')).toBeVisible();

    await page.goto(`${DEMO}#/dienste`);
    await expect(page.getByText('10 Dienste erfasst')).toBeVisible();

    // PDFs erzeugt der Server: in der Demo eine klare Meldung statt eines Fehlers.
    await page.goto(`${DEMO}#/protokolle`);
    await page.getByText('Dienstabende').click();
    await page.getByText('Dienst: Knoten und Stiche').click();
    // Der Text ist bearbeitbar, auch ohne Server, und es erscheint kein Hinweis auf fehlende Verbindung.
    const editor = page.getByLabel('Protokolltext', { exact: true });
    await expect(editor).toContainText('Knoten');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Ergänzung in der Demo.');
    await expect(page.getByText('Gespeichert')).toBeVisible();
    await expect(editor).toContainText('Ergänzung in der Demo.');
    await expect(page.getByText(/^Offline:/)).toHaveCount(0);
    await page.waitForTimeout(3500); // so lange tauscht ein offener Editor sonst aus
    await expect(page.getByText(/^Offline:/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Als PDF exportieren' }).click();
    await expect(page.getByText('in der Demo im Browser gibt es keinen')).toBeVisible();

    expect(foreign).toEqual([]);
    expect(failed).toEqual([]);
  });

  test('Zurücksetzen holt die Beispieldaten zurück', async ({ page }) => {
    await page.goto(`${DEMO}#/aufgaben`);
    await expect(page.getByText('Anmeldung Kreiszeltlager abschicken')).toBeVisible();
    // Eigene Änderung: alle Aufgaben direkt in der Datenbank des Browsers löschen.
    await page.evaluate(async () => {
      const req = indexedDB.open('jf-hub');
      await new Promise((resolve) => (req.onsuccess = resolve));
      const tx = req.result.transaction('tasks', 'readwrite');
      tx.objectStore('tasks').clear();
      await new Promise((resolve) => (tx.oncomplete = resolve));
    });
    await page.reload();
    await expect(page.getByText('Anmeldung Kreiszeltlager abschicken')).toHaveCount(0);

    await page.getByRole('note').getByRole('button', { name: 'Zurücksetzen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Zurücksetzen' }).click();
    await expect(page.getByText('Anmeldung Kreiszeltlager abschicken')).toBeVisible();
  });

  // Der Kopf des Wettkampf-Bereichs (Wettbewerb, Reiter) darf den Inhalt darunter nicht verdecken und keine Beschriftung abschneiden:
  // früher lag er (sticky mit negativen Rändern) bis zu 32 px über dem Zeitnehmer, dem A/B-Wechsel und der Verlauf/Matrix-Wahl.
  for (const width of [320, 360, 390, 1280]) {
    test(`Wettkampf: Kopfzeile verdeckt nichts und schneidet nichts ab (${width} px breit)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${DEMO}#/wettkampf`);
      for (const tab of ['Aufstellung', 'Stoppuhr', 'Analyse']) {
        await page.getByRole('button', { name: tab, exact: true }).click();
        const head = page.locator('.head-compact');
        await expect(head).toBeVisible();
        // Das erste Element unter der Kopfzeile beginnt unterhalb von ihr …
        const first = head.locator('xpath=following-sibling::*[1]');
        await expect(first).toBeVisible();
        const [h, f] = await Promise.all([head.boundingBox(), first.boundingBox()]);
        expect(f!.y, `${tab}: Inhalt beginnt unter der Kopfzeile`).toBeGreaterThanOrEqual(h!.y + h!.height - 0.5);
        // … und keine Reiter- oder Wettbewerbsbeschriftung ist abgeschnitten.
        const clipped = await head.locator('button').evaluateAll((buttons) => buttons.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
        expect(clipped, `${tab}: abgeschnittene Beschriftungen`).toEqual([]);
      }
    });
  }
});
