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

(async () => {
  const root = path.resolve(__dirname, '..');
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
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByText('Da dove cominciamo?', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Nuovo documento', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Contenuto del documento', exact: true });
    await editor.fill('Un documento con più spazio per le idee.');
    await page.getByRole('tab', { name: 'Layout', exact: true }).click();
    await page.getByRole('button', { name: 'Laterale stretta', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Aggiungi sezione', exact: true })).toBeVisible();

    for (const width of [2048, 1424, 1280, 1024]) {
      await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 920), width);
      await settled(page);
      const metrics = await page.locator('.layout-panel').evaluate(panel => ({
        width: window.innerWidth,
        height: panel.getBoundingClientRect().height,
        overflow: panel.scrollWidth > panel.clientWidth,
        editorHeight: document.querySelector('.editor-scroll').getBoundingClientRect().height,
        fields: [...panel.querySelectorAll('.layout-field input, .layout-field select')].map(control => ({
          label: control.getAttribute('aria-label'), font: parseFloat(getComputedStyle(control).fontSize),
          labelFont: parseFloat(getComputedStyle(control.closest('.layout-field').querySelector(':scope > label, :scope > span')).fontSize),
          inputWidth: control.getBoundingClientRect().width,
          height: (control.closest('.layout-number') || control).getBoundingClientRect().height,
          clipped: control.getBoundingClientRect().right > panel.getBoundingClientRect().right,
        })),
      }));
      assert.equal(metrics.width, width);
      assert.equal(metrics.overflow, false, 'Nessuno scorrimento orizzontale nel pannello.');
      assert.ok(metrics.height <= (width >= 1360 ? 145 : 190), 'Barra compatta anche con azioni colonne attive.');
      assert.equal(metrics.fields.length, 10);
      for (const field of metrics.fields) {
        assert.equal(field.font, 10, field.label);
        assert.equal(field.labelFont, 10, field.label);
        assert.equal(field.height, 28, field.label);
        assert.equal(field.clipped, false, field.label);
        assert.ok(field.inputWidth >= 32, 'Valori numerici leggibili: ' + field.label);
      }
      await expect(page.locator('.layout-stepper button')).toHaveCount(14);
      for (const button of await page.locator('.layout-stepper button, .layout-columns-options button').all()) await expect(button).toBeVisible();
      await page.screenshot({ path: path.join(root, 'test-results', `ribbon-${width}.png`), animations: 'disabled' });
      console.log(JSON.stringify(metrics));
    }

    const margin = page.getByLabel('Margine superiore', { exact: true });
    await margin.fill('18.4');
    const expanded = await page.locator('.editor-scroll').boundingBox();
    await page.getByRole('button', { name: 'Riduci strumenti', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mostra strumenti', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.layout-panel')).toBeHidden();
    const collapsed = await page.locator('.editor-scroll').boundingBox();
    assert.ok(collapsed.height - expanded.height >= 120, 'Ridurre gli strumenti libera spazio per il documento.');
    await page.locator('.tiptap .jscript-columns td').first().locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Testo aggiunto.');
    await expect(editor).toContainText('Testo aggiunto.');
    await page.getByRole('button', { name: 'Mostra strumenti', exact: true }).click();
    await expect(margin).toHaveValue('18.4');
    await expect(page.getByRole('button', { name: 'Laterale stretta', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Aumenta interlinea', exact: true }).click();
    await expect(page.getByLabel('Interlinea', { exact: true })).toHaveValue('1.8');
    await page.getByRole('button', { name: 'Diminuisci interlinea', exact: true }).click();
    await expect(page.getByLabel('Interlinea', { exact: true })).toHaveValue('1.7');
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
    await page.screenshot({ path: path.join(root, 'test-results', 'ribbon-dark.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Riduci strumenti', exact: true }).click();
    await page.screenshot({ path: path.join(root, 'test-results', 'ribbon-collapsed.png'), animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log('OK: barra compatta, quattro larghezze, frecce, riduzione e riapertura, bozze dei campi, scrittura e schede da tastiera.');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
