const { _electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { createRequire } = require('node:module');

const DEFAULT_LAYOUT = {
  pageSize: 'A4', orientation: 'portrait',
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
  lineSpacing: 1.7, paragraphBefore: 0, paragraphAfter: 10.8,
};
const CUSTOM_LAYOUT = {
  pageSize: 'A5', orientation: 'landscape',
  margins: { top: 12, right: 13, bottom: 14, left: 15 },
  lineSpacing: 1.5, paragraphBefore: 6, paragraphAfter: 12,
};
const numericLabels = {
  top: 'Margine superiore', right: 'Margine destro',
  bottom: 'Margine inferiore', left: 'Margine sinistro',
  lineSpacing: 'Interlinea', paragraphBefore: 'Spazio prima', paragraphAfter: 'Spazio dopo',
};
const mmToPx = millimetres => millimetres * 96 / 25.4;
const mmToTwips = millimetres => Math.round(millimetres * 1440 / 25.4);

function approximately(actual, expected, label, tolerance = 0.15) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: atteso ${expected}, ricevuto ${actual}`);
}

async function openLayout(page) {
  await page.getByRole('tab', { name: 'Layout', exact: true }).click();
  await expect(page.getByLabel('Formato pagina', { exact: true })).toBeVisible();
}

async function setNumber(page, label, value) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(String(value));
  await input.blur();
  await expect(input).toHaveValue(String(value));
}

async function assertLayoutControls(page, layout) {
  await expect(page.getByLabel('Formato pagina', { exact: true })).toHaveValue(layout.pageSize);
  await expect(page.getByLabel('Orientamento', { exact: true })).toHaveValue(layout.orientation);
  for (const side of ['top', 'right', 'bottom', 'left']) {
    await expect(page.getByLabel(numericLabels[side], { exact: true })).toHaveValue(String(layout.margins[side]));
  }
  for (const field of ['lineSpacing', 'paragraphBefore', 'paragraphAfter']) {
    await expect(page.getByLabel(numericLabels[field], { exact: true })).toHaveValue(String(layout[field]));
  }
}

async function assertRenderedLayout(page, layout, widthMm, heightMm) {
  // Layout commands and the pagination decorations settle in animation frames.
  await expect(async () => {
    const dimensions = await page.locator('.paper').evaluate(paper => {
      const editor = paper.querySelector('.tiptap');
      const paragraph = editor?.querySelector(':scope > p');
      const header = editor?.querySelector('.rm-first-page-header');
      const footer = editor?.querySelector('.rm-page-footer');
      if (!editor || !paragraph || !header || !footer) {
        throw new Error('Il documento deve contenere testo, intestazione e margine inferiore paginati.');
      }
      const style = getComputedStyle(editor);
      const headerStyle = getComputedStyle(header);
      const footerStyle = getComputedStyle(footer);
      const paragraphStyle = getComputedStyle(paragraph);
      return {
        wrapperWidth: parseFloat(getComputedStyle(paper).width),
        width: parseFloat(style.width), minHeight: parseFloat(style.minHeight), height: parseFloat(style.height),
        pageWidth: parseFloat(style.getPropertyValue('--rm-page-width')),
        pageHeight: parseFloat(style.getPropertyValue('--rm-page-height')),
        top: parseFloat(headerStyle.height), topPadding: parseFloat(headerStyle.paddingTop),
        right: parseFloat(style.paddingRight), left: parseFloat(style.paddingLeft),
        bottom: parseFloat(footerStyle.paddingBottom), footerHeight: parseFloat(footerStyle.height),
        pageCount: editor.querySelectorAll('[data-rm-pagination] > .rm-page-break').length,
        lineHeight: parseFloat(paragraphStyle.lineHeight), fontSize: parseFloat(paragraphStyle.fontSize),
        before: parseFloat(paragraphStyle.marginTop), after: parseFloat(paragraphStyle.marginBottom),
      };
    });
    // Computed dimensions are independent of the visual zoom. The plugin owns
    // physical pages and margin spacers; .paper is now a transparent container.
    approximately(dimensions.wrapperWidth, mmToPx(widthMm), 'Larghezza del contenitore');
    approximately(dimensions.width, mmToPx(widthMm), 'Larghezza del foglio');
    approximately(dimensions.pageWidth, mmToPx(widthMm), 'Larghezza fisica della pagina');
    approximately(dimensions.pageHeight, mmToPx(heightMm), 'Altezza fisica della pagina');
    assert.equal(dimensions.pageCount, 1, 'I brevi documenti di prova occupano esattamente una pagina.');
    assert.ok(dimensions.minHeight >= mmToPx(heightMm) - 0.15, 'Altezza minima del documento almeno pari a una pagina.');
    assert.ok(dimensions.height >= mmToPx(heightMm) - 0.15, 'La pagina ha la propria altezza fisica anche senza testo sufficiente.');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      approximately(dimensions[side], mmToPx(layout.margins[side]), `Margine ${side}`);
    }
    approximately(dimensions.topPadding, mmToPx(layout.margins.top), 'Padding superiore dell’intestazione');
    approximately(dimensions.footerHeight, mmToPx(layout.margins.bottom), 'Altezza effettiva del margine inferiore');
    approximately(dimensions.lineHeight / dimensions.fontSize, layout.lineSpacing, 'Interlinea', 0.01);
    approximately(dimensions.before, layout.paragraphBefore * 96 / 72, 'Spazio prima del paragrafo');
    approximately(dimensions.after, layout.paragraphAfter * 96 / 72, 'Spazio dopo il paragrafo');
  }).toPass({ timeout: 10000, intervals: [100, 250, 500] });
  await expect(page.locator('.page-status')).toHaveText('Pagina 1 di 1');
}

async function assertPersistedLayout(page, layout) {
  await expect.poll(async () => page.evaluate(async () => {
    const workspace = await window.jscript.loadAutosave();
    return workspace?.documents?.find(document => document.id === workspace.activeId)?.layout;
  }), { timeout: 10000, message: 'Il layout deve essere salvato nella bozza attiva.' }).toEqual(layout);
  await expect(page.getByText('Bozza salvata sul dispositivo', { exact: true })).toBeVisible();
}

async function assertPaperTextContrast(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect.poll(async () => page.locator('.paper').evaluate(paper => {
    const editor = paper.querySelector('.tiptap');
    const paragraph = editor?.querySelector(':scope > p');
    if (!editor || !paragraph) throw new Error('Il documento non contiene un paragrafo.');
    const luminance = color => {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3 || !color.startsWith('rgb')) {
        throw new Error('Colore CSS non riconosciuto nel controllo di contrasto: ' + color);
      }
      const linear = channels.map(channel => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const foreground = luminance(getComputedStyle(paragraph).color);
    const backgroundColor = getComputedStyle(editor).backgroundColor;
    if (backgroundColor !== 'rgb(255, 255, 255)') {
      throw new Error('La superficie della pagina deve rimanere bianca e opaca: ' + backgroundColor);
    }
    const background = luminance(backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  }), { timeout: 3000, message: 'Il testo normale deve rimanere leggibile sul foglio anche nel tema scuro.' }).toBeGreaterThanOrEqual(4.5);
  const paragraph = page.locator('.tiptap > p').first();
  await expect(paragraph).toBeVisible();
  await expect(paragraph).toContainText('Caffè, città e creatività');
  await expect(page.getByRole('textbox', { name: 'Contenuto del documento', exact: true }))
    .toContainText('Perché scrivere è anche scegliere lo spazio giusto.');
  await expect(page.locator('.tiptap > p')).toHaveCount(2);
  const metrics = await paragraph.evaluate(element => {
    const style = getComputedStyle(element);
    const range = document.createRange();
    range.selectNodeContents(element);
    const textRectangles = [...range.getClientRects()]
      .filter(rectangle => rectangle.width > 0 && rectangle.height > 0)
      .map(rectangle => ({ width: rectangle.width, height: rectangle.height, top: rectangle.top, bottom: rectangle.bottom }));
    return {
      opacity: style.opacity,
      textRectangles, viewportHeight: innerHeight,
    };
  });
  assert.ok(metrics.textRectangles.length > 0, 'Il testo del paragrafo ha dimensioni visibili.');
  assert.ok(metrics.textRectangles.every(rectangle => rectangle.top >= 0 && rectangle.bottom <= metrics.viewportHeight), 'Il primo paragrafo è visibile nello screenshot.');
  assert.ok(Number(metrics.opacity) > 0, 'Il paragrafo non è trasparente.');
}

async function directSaveTo(app, filename) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, filename);
}

function xmlTagAttributes(xml, tag) {
  const found = xml.match(new RegExp(`<w:${tag}\\b[^>]*>`));
  assert.ok(found, `Elemento Word w:${tag} presente`);
  return Object.fromEntries([...found[0].matchAll(/w:([\w]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
}

async function assertDocxLayout(filename) {
  // Mammoth already depends on JSZip; resolve it from that package so pnpm's
  // strict module layout does not require a new direct dependency for this test.
  const mammothRequire = createRequire(require.resolve('mammoth'));
  const JSZip = mammothRequire('jszip');
  const archive = await JSZip.loadAsync(await fs.readFile(filename));
  const main = archive.file('word/document.xml');
  assert.ok(main, 'Il DOCX contiene word/document.xml');
  const xml = await main.async('string');
  const size = xmlTagAttributes(xml, 'pgSz');
  assert.equal(Number(size.w), mmToTwips(210), 'DOCX largo 210 mm');
  assert.equal(Number(size.h), mmToTwips(148), 'DOCX alto 148 mm');
  assert.equal(size.orient, 'landscape');
  const margins = xmlTagAttributes(xml, 'pgMar');
  for (const side of ['top', 'right', 'bottom', 'left']) {
    assert.equal(Number(margins[side]), mmToTwips(CUSTOM_LAYOUT.margins[side]), `DOCX margine ${side}`);
  }
  const spacing = xmlTagAttributes(xml, 'spacing');
  assert.equal(Number(spacing.before), 120, 'DOCX spazio prima 6 pt');
  assert.equal(Number(spacing.after), 240, 'DOCX spazio dopo 12 pt');
  assert.equal(Number(spacing.line), 360, 'DOCX interlinea 1,5');
  assert.equal(spacing.lineRule, 'auto');
  assert.ok(xml.includes('Caffè, città e creatività: una pagina per le idee.'), 'DOCX conserva il primo paragrafo Unicode');
  assert.ok(xml.includes('Perché scrivere è anche scegliere lo spazio giusto.'), 'DOCX conserva il secondo paragrafo Unicode');
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-results');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'jscript-layout-test-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.JSCRIPT_DEV;
  const packaged = process.env.JSCRIPT_TEST_EXECUTABLE;
  const executablePath = packaged || path.join(root, 'node_modules/electron/dist/electron.exe');
  const app = await _electron.launch({
    executablePath, args: [...(packaged ? [] : [root]), '--user-data-dir=' + profile], env, timeout: 30000,
  });
  const errors = [];
  let page;
  try {
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.getByText('Da dove cominciamo?', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Nuovo documento', exact: true }).click();
    const title = 'Verifica layout — città';
    await page.getByLabel('Titolo del documento', { exact: true }).fill(title);
    const editor = page.getByRole('textbox', { name: 'Contenuto del documento', exact: true });
    await editor.fill('Caffè, città e creatività: una pagina per le idee.');
    await editor.press('Control+End');
    await editor.press('Enter');
    await page.keyboard.insertText('Perché scrivere è anche scegliere lo spazio giusto.');
    await expect(page.locator('.tiptap > p')).toHaveCount(2);

    await openLayout(page);
    await assertLayoutControls(page, DEFAULT_LAYOUT);
    await page.getByLabel('Formato pagina', { exact: true }).selectOption('A5');
    await page.getByLabel('Orientamento', { exact: true }).selectOption('landscape');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      await setNumber(page, numericLabels[side], CUSTOM_LAYOUT.margins[side]);
    }
    for (const field of ['lineSpacing', 'paragraphBefore', 'paragraphAfter']) {
      await setNumber(page, numericLabels[field], CUSTOM_LAYOUT[field]);
    }
    await assertLayoutControls(page, CUSTOM_LAYOUT);
    await assertRenderedLayout(page, CUSTOM_LAYOUT, 210, 148);
    await assertPersistedLayout(page, CUSTOM_LAYOUT);

    await assertPaperTextContrast(page);
    await page.screenshot({ path: path.join(output, 'layout-light.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Cambia tema', exact: true }).click();
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
    await assertPaperTextContrast(page);
    await page.screenshot({ path: path.join(output, 'layout-dark.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Cambia tema', exact: true }).click();

    await page.reload();
    await expect(page.getByLabel('Titolo del documento', { exact: true })).toHaveValue(title);
    await expect(editor).toContainText('Caffè, città e creatività');
    await expect(page.locator('.tiptap > p')).toHaveCount(2);
    await openLayout(page);
    await assertLayoutControls(page, CUSTOM_LAYOUT);
    await assertRenderedLayout(page, CUSTOM_LAYOUT, 210, 148);

    const native = path.join(output, 'layout.jscript');
    await directSaveTo(app, native);
    await page.getByRole('button', { name: 'Salva copia', exact: true }).click();
    await page.getByText('Documento JScript salvato.', { exact: true }).waitFor();
    const nativeData = JSON.parse(await fs.readFile(native, 'utf8'));
    assert.equal(nativeData.format, 'jscript');
    assert.equal(nativeData.title, title);
    assert.deepEqual(nativeData.layout, CUSTOM_LAYOUT);
    assert.equal(nativeData.content.content.filter(node => node.type === 'paragraph').length, 2);

    const docx = path.join(output, 'layout.docx');
    await directSaveTo(app, docx);
    await page.getByRole('button', { name: 'Opzioni di esportazione', exact: true }).click();
    await page.getByRole('button', { name: 'Esporta Word (.docx)', exact: true }).click();
    await page.getByText('Documento Word esportato.', { exact: false }).waitFor();
    await assertDocxLayout(docx);

    const pdf = path.join(output, 'layout.pdf');
    await directSaveTo(app, pdf);
    await page.getByRole('button', { name: 'Opzioni di esportazione', exact: true }).click();
    await page.getByRole('button', { name: 'Esporta PDF', exact: true }).click();
    await page.getByText('PDF salvato.', { exact: true }).waitFor({ timeout: 30000 });
    assert.equal((await fs.readFile(pdf)).subarray(0, 4).toString(), '%PDF');

    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    }, native);
    await page.getByRole('button', { name: /Apri dal computer/ }).click();
    await expect(page.locator('.document-item')).toHaveCount(2);
    await expect(editor).toContainText('Perché scrivere è anche scegliere lo spazio giusto.');
    await openLayout(page);
    await assertLayoutControls(page, CUSTOM_LAYOUT);
    await assertRenderedLayout(page, CUSTOM_LAYOUT, 210, 148);
    await page.getByLabel('Titolo del documento', { exact: true }).fill('Layout reimportato');
    await assertPersistedLayout(page, CUSTOM_LAYOUT);

    await page.getByRole('button', { name: 'Nuovo documento', exact: true }).click();
    await page.getByLabel('Titolo del documento', { exact: true }).fill('Layout predefinito');
    await openLayout(page);
    await assertLayoutControls(page, DEFAULT_LAYOUT);
    await assertRenderedLayout(page, DEFAULT_LAYOUT, 210, 297);
    await assertPersistedLayout(page, DEFAULT_LAYOUT);

    await page.locator('.document-open').filter({ has: page.getByText(title, { exact: true }) }).click();
    await openLayout(page);
    await assertLayoutControls(page, CUSTOM_LAYOUT);
    await page.getByRole('button', { name: 'Ripristina layout', exact: true }).click();
    await assertLayoutControls(page, DEFAULT_LAYOUT);
    await assertRenderedLayout(page, DEFAULT_LAYOUT, 210, 297);
    await assertPersistedLayout(page, DEFAULT_LAYOUT);

    await page.locator('.document-open').filter({ has: page.getByText('Layout reimportato', { exact: true }) }).click();
    await openLayout(page);
    await assertLayoutControls(page, CUSTOM_LAYOUT);
    await assertPersistedLayout(page, CUSTOM_LAYOUT);
    assert.deepEqual(errors, [], 'Nessun errore JavaScript durante il flusso layout');
    console.log('Layout desktop verificato: controlli, A5 orizzontale, margini e spaziature CSS, autosalvataggio, riapertura, JSON/DOCX/PDF, reimportazione, isolamento fra documenti e ripristino.');
    console.log('Artefatti: ' + output);
    console.log('Profilo isolato: ' + profile);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'layout-failure.png') }).catch(() => {});
    throw error;
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exit(1); });
