import { expect, test } from '@playwright/test';
import * as Y from 'yjs';
import { ADMIN, adminTokens, foreignParagraph, PNG_1X1, pdfText, putForeignText, serverDoc, serverHasText, sessions, syncNow, writeProtocol } from './helpers';

// Eigener Server (siehe playwright.config.ts): Die Anmeldung ist je Adresse begrenzt, und diese Datei soll weder das Limit des
// Rauchtests noch das der Protokoll-Tests aufbrauchen.
test.use({ baseURL: 'http://127.0.0.1:8095' });

const adminToken = adminTokens();
const open = sessions();

test.describe.serial('Protokolle: Tabellen, Links und Hervorhebung', () => {
  test('Tabelle, Link und Hervorhebung einfügen, speichern und im PDF finden', async ({ browser, request }) => {
    const title = 'Aufgaben mit Tabelle';
    const token = await adminToken(request);
    const { context, page } = await open(browser, ADMIN);
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

    // Ein Klick in den Link zeigt die Link-Leiste: Link öffnen, ändern, entfernen
    await link.click();
    const linkBar = page.getByRole('toolbar', { name: 'Link' });
    await expect(linkBar).toContainText('beispiel.de');
    await linkBar.getByRole('button', { name: 'Link öffnen' }).click();
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['https://beispiel.de']);
    await linkBar.getByRole('button', { name: 'Link ändern' }).click();
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
    const doc = await serverHasText(request, token, title, 'https://www.example.de/seite');
    const json = JSON.stringify(doc.content);
    for (const part of ['"type":"table"', '"type":"tableHeader"', '"type":"tableCell"', '"type":"link"', '"type":"highlight"', 'https://www.example.de/seite']) expect(json, part).toContain(part);

    // Nach dem Neuladen ist alles noch da
    await page.reload();
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('mark')).toHaveText('Material');
    await expect(editor.locator('a')).toHaveAttribute('href', 'https://www.example.de/seite');

    // Das PDF enthält die Tabelle (Text) und den anklickbaren Link
    const pdf = await request.get(`/api/protocols/${doc.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    expect(pdf.status()).toBe(200);
    const bytes = (await pdf.body()).toString('latin1');
    expect(bytes.startsWith('%PDF-')).toBe(true);
    expect(bytes).toContain('https://www.example.de/seite');
    const text = pdfText(await pdf.body());
    if (text !== null) for (const part of ['Wer', 'Aufgabe', 'Anna', 'Schläuche', 'Ben', 'Material', 'Webseite']) expect(text, part).toContain(part);
    await context.close();
  });

  test('Foto und Trennlinie aus einer Tabellenzelle heraus landen hinter der Tabelle und zerteilen sie nicht', async ({ browser, request }) => {
    await adminToken(request);
    const { context, page } = await open(browser, ADMIN);
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

  test('die Wahl „Ohne Kopfzeile“ schickt das Formular nicht ab; eine Tabelle mit Inhalt wird erst nach Rückfrage gelöscht', async ({ browser, request }) => {
    await adminToken(request);
    const { context, page } = await open(browser, ADMIN);
    await writeProtocol(page, 'Tabelle ohne Kopf', 'Text.');
    const editor = page.getByLabel('Protokolltext', { exact: true });
    await page.getByRole('button', { name: 'Einfügen', exact: true }).click();
    await page.getByRole('dialog', { name: 'Einfügen' }).getByRole('button', { name: /^Tabelle/ }).click();
    await page.getByRole('button', { name: 'Ohne Kopfzeile' }).click();
    await expect(page.getByRole('dialog', { name: 'Tabelle einfügen' })).toBeVisible(); // nicht abgeschickt
    await expect(editor.locator('table')).toHaveCount(0);
    await page.getByLabel(/^Zeilen/).fill('2');
    await page.getByLabel(/^Spalten/).fill('2');
    await page.getByRole('button', { name: 'Tabelle einfügen', exact: true }).click();
    await expect(editor.locator('tr')).toHaveCount(2);
    await expect(editor.locator('th')).toHaveCount(0);

    // Löschen: Bei Inhalt fragt der Editor nach; „Abbrechen“ lässt die Tabelle stehen
    await page.keyboard.type('Wichtiger Eintrag');
    const bar = page.getByRole('toolbar', { name: 'Tabelle' });
    await bar.getByRole('button', { name: 'Tabelle löschen' }).click();
    const ask = page.getByRole('alertdialog', { name: 'Tabelle löschen' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(editor.locator('table')).toHaveCount(1);
    await bar.getByRole('button', { name: 'Tabelle löschen' }).click();
    await page.getByRole('alertdialog', { name: 'Tabelle löschen' }).getByRole('button', { name: 'Löschen' }).click();
    await expect(editor.locator('table')).toHaveCount(0);
    await context.close();
  });

  test('Einfügen aus anderen Programmen: Tabellen bleiben ganz, Spannen sind begrenzt, unzulässige Adressen werden kein Link', async ({ browser, request }) => {
    await adminToken(request);
    const { context, page } = await open(browser, ADMIN);
    await writeProtocol(page, 'Einfügen von außen', 'Wort');
    const editor = page.getByLabel('Protokolltext', { exact: true });
    const paste = (text: string, html?: string) =>
      page.evaluate(
        ({ text, html }) => {
          const data = new DataTransfer();
          data.setData('text/plain', text);
          if (html) data.setData('text/html', html);
          document.querySelector('.ed-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        },
        { text, html },
      );
    const clear = async () => {
      await editor.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
    };

    // Überschrift, Zitat, Trennlinie, Codeblock und eine Tabelle in der Zelle zerreißen die Tabelle nicht: Der Text bleibt.
    await clear();
    await paste(
      'x',
      '<table><tr><td><h2>Titel</h2><p>x</p></td><td><blockquote>zitat</blockquote><hr><pre>code\nzwei</pre></td></tr>' +
        '<tr><td>außen<table><tr><td>innen1</td><td>innen2</td></tr></table></td><td>b</td></tr></table>',
    );
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('tr')).toHaveCount(2);
    await expect(editor.locator('td h1, td h2, td h3, td blockquote, td pre, td hr, td table')).toHaveCount(0);
    for (const part of ['Titel', 'zitat', 'code', 'zwei', 'außen', 'innen1', 'innen2']) await expect(editor.locator('table')).toContainText(part);

    // Riesige Spannen werden gekürzt, statt dem Editor Tausende Spalten aufzuzwingen
    await clear();
    await paste('x', '<table><tr><td colspan="5000" rowspan="9999">breit</td></tr></table>');
    await expect(editor.locator('table')).toHaveCount(1);
    expect(await editor.locator('col').count()).toBeLessThanOrEqual(24);

    // Eine Adresse über markiertem Text: nur erlaubte Ziele werden zum Link
    for (const bad of ['ftp://example.com/x', 'ftps://example.com/y', 'file:///etc/passwd']) {
      await clear();
      await page.keyboard.type('Wort');
      await page.keyboard.press('Control+A');
      await paste(bad);
      await expect(editor.locator('a'), bad).toHaveCount(0);
    }
    await clear();
    await page.keyboard.type('Wort');
    await page.keyboard.press('Control+A');
    await paste('www.example.de');
    await expect(editor.locator('a')).toHaveAttribute('href', 'https://www.example.de');
    await expect(editor.locator('a')).toHaveText('Wort');
    await context.close();
  });

  test('am Handy: Leiste, Tabelle und Link passen auf den Bildschirm', async ({ browser, request }) => {
    const title = 'Handy mit Tabelle';
    await adminToken(request);
    const { context, page } = await open(browser, ADMIN, { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
    await writeProtocol(page, title, 'Kurz.');
    const editor = page.getByLabel('Protokolltext', { exact: true });
    // Was beim Notieren gebraucht wird, steht ohne Wischen in der Leiste (sonst bliebe „Einfügen“, der einzige Weg zu Tabellen, verborgen)
    for (const name of ['Fett', 'Kursiv', 'Aufzählung', 'Nummerierung', 'Checkliste', 'Foto oder Datei anhängen', 'Einfügen']) {
      const box = await page.getByRole('toolbar', { name: 'Formatierung' }).getByRole('button', { name, exact: true }).boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.x + box!.width, `${name} ragt über den Bildschirmrand`).toBeLessThanOrEqual(390);
    }
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

test.describe.serial('Protokolle: feindliche Tabellen', () => {
  test('ein Protokoll mit absurder Zellspanne wird nur gelesen, statt den Editor lahmzulegen', async ({ browser, request }) => {
    const title = 'Tabelle mit Riesenspanne';
    const token = await adminToken(request);
    await putForeignText(request, token, 'spanne-0001', title, (frag) => {
      const cell = new Y.XmlElement('tableCell');
      cell.setAttribute('colspan', 1_000_000 as never);
      cell.setAttribute('rowspan', 1 as never);
      cell.insert(0, [foreignParagraph('Zelle')]);
      const row = new Y.XmlElement('tableRow');
      row.insert(0, [cell]);
      const table = new Y.XmlElement('table');
      table.insert(0, [row]);
      frag.insert(0, [foreignParagraph('Davor'), table]);
    });

    const { context, page } = await open(browser, ADMIN);
    await page.goto('/#/protokolle');
    await page.getByText(title).click();
    // Mit einer Million Spalten bräuchte der Editor Minuten: Das Protokoll öffnet nur lesend, und zwar sofort.
    await expect(page.getByRole('alert')).toContainText('Elemente, die diese App-Version nicht kennt', { timeout: 5000 });
    await expect(page.getByLabel('Protokolltext', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Zelle')).toBeVisible();
    await context.close();
  });
});
