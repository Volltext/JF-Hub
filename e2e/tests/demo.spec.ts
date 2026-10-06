import { expect, test } from '@playwright/test';

/** Zweiter Server mit DEMO=1, siehe playwright.config.ts. */
const DEMO = 'http://127.0.0.1:8098';

test.describe('Demo-Instanz', () => {
  test('Ein Klick meldet an, die Beispieldaten sind da', async ({ page }) => {
    await page.goto(`${DEMO}/`);
    await page.getByRole('button', { name: /Als Tobias Wagner anmelden/ }).click();
    await expect(page.getByRole('note')).toContainText('Bitte keine echten Daten eintragen');
    await expect(page.getByText('Anmeldung Kreiszeltlager abschicken')).toBeVisible();

    await page.goto(`${DEMO}/#/protokolle`);
    await expect(page.getByText('Dienstabende')).toBeVisible();
    await expect(page.getByText('Ideen Spieleabend (privat)')).toBeVisible();
    // Privates von Jana sieht Tobias nicht.
    await expect(page.getByText('Notizen Jahresplanung (privat)')).toHaveCount(0);
  });

  test('Verwaltung: Demo-Zugang und gesperrtes Backup', async ({ page }) => {
    await page.goto(`${DEMO}/admin/`);
    await page.getByRole('button', { name: 'Als Jana Becker anmelden' }).click();
    await expect(page.getByRole('note')).toContainText('täglich um 03:00 Uhr');
    await page.goto(`${DEMO}/admin/#/backup`);
    await page.getByRole('button', { name: 'Aktuelles Datenbank-Backup laden' }).click();
    await expect(page.getByText('In der Demo ausgeschaltet.')).toBeVisible();
  });
});
