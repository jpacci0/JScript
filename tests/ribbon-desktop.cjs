const { _electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

async function settled(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function openGroup(page, name) {
  const trigger = page.getByRole('button', { name, exact: true });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await expect(page.getByRole('dialog', { name, exact: true })).toBeVisible();
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-results');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'jscript-ribbon-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.JSCRIPT_DEV;
  const executable = process.env.JSCRIPT_TEST_EXECUTABLE;
  const app = await _electron.launch({
    executablePath: executable || path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [...(executable ? [] : [root]), '--user-data-dir=' + profile], env, timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByText('Da dove cominciamo?', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Nuovo documento', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Contenuto del documento', exact: true });
    await editor.fill('Un documento con più spazio per le idee.');
    await page.getByRole('tab', { name: 'Layout', exact: true }).click();
    await openGroup(page, 'Colonne');
    await page.getByRole('button', { name: 'Laterale stretta', exact: true }).click();
    await openGroup(page, 'Colonne');
    await expect(page.getByRole('button', { name: 'Aggiungi sezione', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    for (const width of [2048, 1424, 1366, 1024]) {
      await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 768), width);
      await settled(page);
      const metrics = await page.locator('.layout-panel').evaluate(panel => ({
        width: innerWidth, height: panel.getBoundingClientRect().height,
        overflow: panel.scrollWidth > panel.clientWidth,
        headerHeight: document.querySelector('.app-header').getBoundingClientRect().height,
        editorHeight: document.querySelector('.editor-scroll').getBoundingClientRect().height,
        titleInHeader: Boolean(document.querySelector('.app-header [aria-label="Titolo del documento"]')),
        saveInHeader: [...document.querySelectorAll('.app-header button')].some(button => button.textContent.includes('Salva copia')),
        triggers: [...panel.querySelectorAll('.compact-layout-trigger')].map(button => ({
          left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right,
        })),
      }));
      assert.equal(metrics.width, width);
      assert.equal(metrics.overflow, false, 'Nessuno scorrimento orizzontale nella barra.');
      assert.equal(metrics.height, 44, 'Layout rimane su una riga anche con colonne attive.');
      assert.equal(metrics.headerHeight, 56, 'Titolo e azioni condividono la riga del logo.');
      assert.ok(metrics.editorHeight >= 590, 'Il foglio conserva almeno 590px su uno schermo alto768px.');
      assert.equal(metrics.titleInHeader, true);
      assert.equal(metrics.saveInHeader, true);
      assert.equal(metrics.triggers.length, 4);
      assert.ok(metrics.triggers.every(button => button.left >= 0 && button.right <= width));
      let fieldCount = 0;
      for (const group of ['Pagina', 'Margini', 'Spaziatura', 'Colonne']) {
        await openGroup(page, group);
        const panelMetrics = await page.getByRole('dialog', { name: group, exact: true }).evaluate(panel => {
          const box = panel.getBoundingClientRect();
          return { left: box.left, right: box.right, bottom: box.bottom, viewportHeight: innerHeight,
            fields: [...panel.querySelectorAll('.layout-field input, .layout-field select')].map(control => ({
              label: control.getAttribute('aria-label'), font: parseFloat(getComputedStyle(control).fontSize),
              labelFont: parseFloat(getComputedStyle(control.closest('.layout-field').querySelector(':scope > label, :scope > span')).fontSize),
              inputWidth: control.getBoundingClientRect().width,
              height: (control.closest('.layout-number') || control).getBoundingClientRect().height,
              right: control.getBoundingClientRect().right,
            })),
          };
        });
        assert.ok(panelMetrics.left >= 0 && panelMetrics.right <= width && panelMetrics.bottom <= panelMetrics.viewportHeight,
          group + ': il pannello resta dentro lo schermo');
        for (const field of panelMetrics.fields) {
          assert.equal(field.font, 10, field.label);
          assert.equal(field.labelFont, 10, field.label);
          assert.equal(field.height, 28, field.label);
          assert.ok(field.right <= panelMetrics.right && field.inputWidth >= 32, field.label);
        }
        fieldCount += panelMetrics.fields.length;
        const openHeight = (await page.locator('.editor-scroll').boundingBox()).height;
        assert.equal(openHeight, metrics.editorHeight, 'Il pannello aperto non riduce il foglio.');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: group, exact: true })).toHaveAttribute('aria-expanded', 'false');
      }
      assert.equal(fieldCount, 10);
      await page.screenshot({ path: path.join(output, `ribbon-${width}.png`), animations: 'disabled' });
      console.log(JSON.stringify(metrics));
    }

    await openGroup(page, 'Margini');
    const margin = page.getByLabel('Margine superiore', { exact: true });
    await margin.fill('18.4');
    const expanded = await page.locator('.editor-scroll').boundingBox();
    await page.getByRole('button', { name: 'Riduci strumenti', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mostra strumenti', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.layout-panel')).toBeHidden();
    const collapsed = await page.locator('.editor-scroll').boundingBox();
    assert.ok(collapsed.height - expanded.height >= 43, 'Ridurre la barra libera44px per il documento.');
    await page.locator('.tiptap .jscript-columns td').first().locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Testo aggiunto.');
    await expect(editor).toContainText('Testo aggiunto.');
    await page.getByRole('button', { name: 'Mostra strumenti', exact: true }).click();
    await openGroup(page, 'Margini');
    await expect(margin).toHaveValue('18.4');
    await openGroup(page, 'Colonne');
    await expect(page.getByRole('button', { name: 'Laterale stretta', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await openGroup(page, 'Spaziatura');
    await page.getByRole('button', { name: 'Aumenta interlinea', exact: true }).click();
    await expect(page.getByLabel('Interlinea', { exact: true })).toHaveValue('1.8');
    await page.getByRole('button', { name: 'Diminuisci interlinea', exact: true }).click();
    await expect(page.getByLabel('Interlinea', { exact: true })).toHaveValue('1.7');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Riduci strumenti', exact: true }).click();
    await page.getByRole('tab', { name: 'Layout', exact: true }).click();
    await expect(page.locator('.layout-panel')).toBeVisible();
    await page.getByRole('tab', { name: 'Layout', exact: true }).press('ArrowLeft');
    await expect(page.locator('.writing-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Riduci strumenti', exact: true }).click();
    await expect(page.locator('.writing-panel')).toBeHidden();
    await page.getByRole('tab', { name: 'Scrittura', exact: true }).press('ArrowRight');
    await expect(page.locator('.layout-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Cambia tema', exact: true }).click();
    await settled(page);
    await page.screenshot({ path: path.join(output, 'ribbon-dark.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Riduci strumenti', exact: true }).click();
    await page.screenshot({ path: path.join(output, 'ribbon-collapsed.png'), animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log('OK: titolo e azioni in alto, Layout44px, quattro larghezze a768px, pannelli dentro lo schermo, frecce, riduzione, bozze e tastiera.');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
