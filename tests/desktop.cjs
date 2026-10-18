const { _electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-results');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'jscript-test-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.JSCRIPT_TEST_EXECUTABLE;
  const executablePath = packaged || path.join(root, 'node_modules/electron/dist/electron.exe');
  const app = await _electron.launch({ executablePath, args: [...(packaged ? [] : [root]), '--user-data-dir=' + profile], env, timeout: 30000 });
  const errors = [];
  let page;
  let electronStderr = '';
  app.process().stderr?.on('data', data => { electronStderr = (electronStderr + data.toString()).slice(-8000); });
  try {
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.getByText('Da dove cominciamo?', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'home.png') });
    await page.getByRole('button', { name: 'Progetto Dai forma a un obiettivo' }).click();
    const editor = page.getByRole('textbox', { name: 'Contenuto del documento' });
    await expect(editor).toContainText('Una nuova prospettiva');
    await page.getByLabel('Titolo del documento').fill('Verifica JScript');
    await editor.click();
    await editor.press('Control+End');
    await editor.press('Enter');
    await editor.pressSequentially('Test Unicode: caffè, perché, città.');
    await page.getByRole('button', { name: 'Inserisci tabella 3 × 3', exact: true }).click();
    await expect(page.locator('.tiptap table')).toHaveCount(1);
    await page.getByRole('button', { name: 'Annulla · Ctrl Z', exact: true }).click();
    await expect(page.locator('.tiptap table')).toHaveCount(0);
    await page.getByRole('button', { name: 'Ripristina · Ctrl Y', exact: true }).click();
    await expect(page.locator('.tiptap table')).toHaveCount(1);
    await page.getByText('Bozza salvata sul dispositivo', { exact: true }).waitFor();
    await page.reload();
    await expect(page.getByLabel('Titolo del documento')).toHaveValue('Verifica JScript');
    await expect(editor).toContainText('Test Unicode: caffè, perché, città.');
    await expect(page.locator('.tiptap table')).toHaveCount(1);
    await page.screenshot({ path: path.join(output, 'editor.png') });
    const native = path.join(output, 'roundtrip.jscript');
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, native);
    await page.getByRole('button', { name: 'Salva copia', exact: true }).click();
    await page.getByText('Documento JScript salvato.', { exact: true }).waitFor();
    const nativeData = JSON.parse(await fs.readFile(native, 'utf8'));
    assert.equal(nativeData.format, 'jscript');
    assert.equal(nativeData.title, 'Verifica JScript');
    const docx = path.join(output, 'roundtrip.docx');
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, docx);
    await page.getByRole('button', { name: 'Opzioni di esportazione' }).click();
    await page.getByRole('button', { name: 'Esporta Word (.docx)', exact: true }).click();
    await page.getByText('Documento Word esportato.', { exact: false }).waitFor();
    assert.equal((await fs.readFile(docx)).subarray(0, 2).toString(), 'PK');
    const pdf = path.join(output, 'roundtrip.pdf');
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, pdf);
    await page.getByRole('button', { name: 'Opzioni di esportazione' }).click();
    await page.getByRole('button', { name: 'Esporta PDF', exact: true }).click();
    await page.getByText('PDF salvato.', { exact: true }).or(page.getByRole('alert')).waitFor({ timeout: 30000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('PDF salvato.', { exact: true })).toBeVisible();
    assert.equal((await fs.readFile(pdf)).subarray(0, 4).toString(), '%PDF');
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, docx);
    await page.getByRole('button', { name: /Apri dal computer/ }).click();
    await expect(page.locator('.document-item')).toHaveCount(2);
    await expect(editor).toContainText('Test Unicode: caffè, perché, città.');
    await expect(page.locator('.tiptap table')).toHaveCount(1);
    await page.getByRole('button', { name: 'Cambia tema' }).click();
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Modalità concentrazione' }).click();
    await expect(page.locator('.app')).toHaveClass(/focus-mode/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.app')).not.toHaveClass(/focus-mode/);
    await page.getByText('Bozza salvata sul dispositivo', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Desktop E2E passed: startup, editing, table undo/redo, autosave/reload, native save, DOCX export/import, PDF, theme, focus.');
    console.log('Test profile: ' + profile);
  } catch (error) {
    console.error('Desktop diagnostics:', JSON.stringify({
      errors, electronStderr,
      notices: page ? await page.locator('.toast').allTextContents().catch(() => []) : [],
      windows: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
        visible: window.isVisible(), bounds: window.getBounds(),
        url: window.webContents.getURL(), loading: window.webContents.isLoading(),
      }))).catch(() => []),
    }));
    await page?.screenshot({ path: path.join(output, 'desktop-failure.png') }).catch(() => {});
    throw error;
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exit(1); });
