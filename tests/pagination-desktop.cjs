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
const PAGE_SELECTOR = '.tiptap [data-rm-pagination] > .rm-page-break';
const ENTER_COUNT = 42;
const FIRST_TEXT = 'Prima pagina: caffè, città e creatività.';
const MARKER = 'MARCATORE FINALE — il testo continua nella pagina successiva.';
const SHORT_TEXT = 'Documento ridotto a una sola pagina.';
const LONG_TEXT = Array.from({ length: 110 }, (_, index) =>
  `Passaggio ${index + 1}: scrivere con cura significa lasciare spazio alle idee, alla città e alla creatività.`
).join(' ');
const mmToPx = value => value * 96 / 25.4;
const paragraph = text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });

async function settled(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function pageCountAtLeast(page, minimum) {
  await expect.poll(() => page.locator(PAGE_SELECTOR).count(), { timeout: 15000 })
    .toBeGreaterThanOrEqual(minimum);
  await settled(page);
}

async function persistedDocument(page, expectedText, expectedParagraphs, expectedLayout) {
  const read = () => page.evaluate(async () => {
    const workspace = await window.jscript.loadAutosave();
    return workspace?.documents?.find(document => document.id === workspace.activeId);
  });
  await expect.poll(async () => {
    const document = await read();
    if (!document) return null;
    const text = node => (node.text || '') + (node.content || []).map(text).join('');
    return {
      text: text(document.content),
      paragraphs: document.content.content.filter(node => node.type === 'paragraph').length,
      ...(expectedLayout ? { layout: document.layout } : {}),
    };
  }, { timeout: 10000, message: 'Testo e paragrafi devono essere salvati senza elementi di impaginazione.' })
    .toEqual({ text: expectedText, paragraphs: expectedParagraphs, ...(expectedLayout ? { layout: expectedLayout } : {}) });
  return read();
}

async function lineGeometry(page, selector = '.tiptap > p') {
  return page.evaluate(selector => {
    const editor = document.querySelector('.tiptap');
    const rect = element => {
      const value = element.getBoundingClientRect();
      return { top: value.top, bottom: value.bottom, left: value.left, right: value.right, width: value.width, height: value.height };
    };
    const gaps = [...editor.querySelectorAll('.rm-pagination-gap')]
      .filter(element => getComputedStyle(element).display !== 'none')
      .map(rect).filter(value => value.height > 0);
    const exclusions = [...editor.querySelectorAll('.rm-page-break > .breaker')]
      .map(rect).filter(value => value.height > 0);
    const paragraphs = [...document.querySelectorAll(selector)];
    const lines = paragraphs.flatMap((element, paragraphIndex) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()].filter(value => value.height > 0).map(value => ({
        paragraphIndex, top: value.top, bottom: value.bottom, left: value.left, right: value.right,
      }));
    });
    const overlaps = lines.flatMap((line, lineIndex) => exclusions.flatMap((gap, gapIndex) => {
      const overlap = Math.min(line.bottom, gap.bottom) - Math.max(line.top, gap.top);
      return overlap > 1 ? [{ lineIndex, paragraphIndex: line.paragraphIndex, gapIndex, overlap, line, gap }] : [];
    }));
    return { gaps, exclusions, lines, overlaps, paragraphRects: paragraphs.map(rect) };
  }, selector);
}

async function assertNoLinesInPageGaps(page, selector = '.tiptap > p') {
  await expect.poll(async () => (await lineGeometry(page, selector)).overlaps.length, {
    timeout: 15000,
    message: 'Le righe devono saltare margini e intervalli fra i fogli, senza essere coperte dai separatori.',
  }).toBe(0);
  const geometry = await lineGeometry(page, selector);
  assert.ok(geometry.gaps.length >= 1, 'Esiste almeno un intervallo visibile fra due pagine.');
  assert.ok(geometry.lines.length > 0, 'Sono stati misurati i rettangoli reali del contenuto.');
  return geometry;
}

async function screenshotFirstBoundary(page, filename) {
  // Keep the pagination hook from following the editing caret during this view.
  await page.getByLabel('Titolo del documento', { exact: true }).click();
  await page.locator('.editor-scroll').evaluate(element => {
    const gap = element.querySelector('.rm-pagination-gap');
    const bounds = element.getBoundingClientRect();
    element.scrollTop += gap.getBoundingClientRect().top - bounds.top - bounds.height * 0.35;
  });
  await settled(page);
  await page.screenshot({ path: filename, animations: 'disabled' });
}

async function saveNative(app, page, filename) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, filename);
  await page.getByRole('button', { name: 'Salva copia', exact: true }).click();
  await page.getByText('Documento JScript salvato.', { exact: true }).waitFor();
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}

async function exportFromMenu(app, page, filename, format) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, filename);
  await page.getByRole('button', { name: 'Opzioni di esportazione', exact: true }).click();
  await page.getByRole('button', { name: format === 'docx' ? 'Esporta Word (.docx)' : 'Esporta PDF', exact: true }).click();
  await page.getByText(format === 'docx' ? 'Documento Word esportato.' : 'PDF salvato.', { exact: format !== 'docx' })
    .waitFor({ timeout: 30000 });
  const bytes = await fs.readFile(filename);
  assert.equal(bytes.subarray(0, format === 'docx' ? 2 : 4).toString(), format === 'docx' ? 'PK' : '%PDF');
}

async function checkDocx(page, filename, expectedText, expectedParagraphs) {
  const mammothRequire = createRequire(require.resolve('mammoth'));
  const JSZip = mammothRequire('jszip');
  const zip = await JSZip.loadAsync(await fs.readFile(filename));
  const part = zip.file('word/document.xml');
  assert.ok(part, 'Il DOCX contiene word/document.xml.');
  const xml = await part.async('string');
  const document = await page.evaluate(xml => {
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    return {
      text: [...parsed.getElementsByTagName('w:t')].map(element => element.textContent).join(''),
      paragraphs: parsed.getElementsByTagName('w:p').length,
      parseErrors: parsed.getElementsByTagName('parsererror').length,
    };
  }, xml);
  assert.equal(document.parseErrors, 0);
  assert.equal(document.text, expectedText, 'Il DOCX contiene solo il testo del modello, senza numeri o elementi della vista.');
  assert.equal(document.paragraphs, expectedParagraphs, 'Il DOCX conserva anche i paragrafi vuoti.');
  assert.ok(!/rm-page|rm-pagination|data-rm-pagination/.test(xml), 'Nessun elemento visuale esportato nel DOCX.');
}

async function importFixture(app, page, filename, title, content) {
  await fs.writeFile(filename, JSON.stringify({
    format: 'jscript', version: 1, title, layout: DEFAULT_LAYOUT,
    updatedAt: new Date().toISOString(), content: { type: 'doc', content },
  }), 'utf8');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, filename);
  await page.getByRole('button', { name: /Apri dal computer/ }).click();
  await expect(page.getByLabel('Titolo del documento', { exact: true })).toHaveValue(title);
}

function checkNative(document, expectedText, expectedParagraphs) {
  const text = node => (node.text || '') + (node.content || []).map(text).join('');
  assert.equal(document.format, 'jscript');
  assert.equal(text(document.content), expectedText);
  assert.equal(document.content.content.filter(node => node.type === 'paragraph').length, expectedParagraphs);
  assert.ok(!/rm-page|rm-pagination|data-rm-pagination/.test(JSON.stringify(document.content)), 'Nessuna decorazione nel JSON.');
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-results');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'jscript-pagination-test-'));
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
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.getByText('Da dove cominciamo?', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Nuovo documento', exact: true }).click();
    await page.getByLabel('Titolo del documento', { exact: true }).fill('Invio e pagine automatiche');
    const editor = page.getByRole('textbox', { name: 'Contenuto del documento', exact: true });
    await editor.fill(FIRST_TEXT);
    await editor.press('Control+End');
    for (let index = 0; index < ENTER_COUNT; index++) await editor.press('Enter');
    await expect(page.locator('.tiptap > p')).toHaveCount(ENTER_COUNT + 1);
    await pageCountAtLeast(page, 2);
    await assertNoLinesInPageGaps(page);
    // ProseMirror's default history groups changes within 500 ms. Separate the
    // marker from the Enter sequence so this checks a meaningful undo boundary.
    await page.waitForTimeout(550);
    await page.keyboard.insertText(MARKER);
    await expect(editor).toContainText(MARKER);
    await editor.press('Control+z');
    await expect(editor).not.toContainText(MARKER);
    await expect(page.locator('.tiptap > p')).toHaveCount(ENTER_COUNT + 1);
    await editor.press('Control+y');
    await expect(editor).toContainText(MARKER);
    await expect(page.locator('.tiptap > p')).toHaveCount(ENTER_COUNT + 1);
    const enteredGeometry = await assertNoLinesInPageGaps(page);
    const lastParagraph = enteredGeometry.paragraphRects.at(-1);
    assert.ok(lastParagraph.top >= enteredGeometry.gaps[0].bottom - 1, 'Il paragrafo finale è oltre il primo intervallo, nella pagina successiva.');
    await persistedDocument(page, FIRST_TEXT + MARKER, ENTER_COUNT + 1);
    await screenshotFirstBoundary(page, path.join(output, 'pagination-enter.png'));

    const enteredNative = await saveNative(app, page, path.join(output, 'pagination-enter.jscript'));
    checkNative(enteredNative, FIRST_TEXT + MARKER, ENTER_COUNT + 1);
    await exportFromMenu(app, page, path.join(output, 'pagination-enter.docx'), 'docx');
    await checkDocx(page, path.join(output, 'pagination-enter.docx'), FIRST_TEXT + MARKER, ENTER_COUNT + 1);
    await exportFromMenu(app, page, path.join(output, 'pagination-enter.pdf'), 'pdf');
    await page.reload();
    await expect(page.getByLabel('Titolo del documento', { exact: true })).toHaveValue('Invio e pagine automatiche');
    await expect(editor).toContainText(MARKER);
    await expect(page.locator('.tiptap > p')).toHaveCount(ENTER_COUNT + 1);
    await pageCountAtLeast(page, 2);
    await assertNoLinesInPageGaps(page);

    await editor.focus();
    await editor.press('Control+a');
    await page.keyboard.insertText(SHORT_TEXT);
    await expect(page.locator('.tiptap > p')).toHaveCount(1);
    await expect(editor).toContainText(SHORT_TEXT);
    await expect.poll(() => page.locator(PAGE_SELECTOR).count(), { timeout: 15000 }).toBe(1);
    await persistedDocument(page, SHORT_TEXT, 1);

    await importFixture(app, page, path.join(output, 'pagination-long-input.jscript'), 'Un solo paragrafo su più pagine', [paragraph(LONG_TEXT)]);
    await expect(page.locator('.tiptap > p')).toHaveCount(1);
    await expect(editor).toContainText(LONG_TEXT);
    await pageCountAtLeast(page, 2);
    const longGeometry = await assertNoLinesInPageGaps(page);
    assert.ok(longGeometry.lines.some(line => line.bottom <= longGeometry.gaps[0].top), 'Il paragrafo ha righe prima del salto.');
    assert.ok(longGeometry.lines.some(line => line.top >= longGeometry.gaps[0].bottom), 'Lo stesso paragrafo riprende dopo il salto.');
    await screenshotFirstBoundary(page, path.join(output, 'pagination-long.png'));

    // A document-wide selection crosses the page boundaries in the same model.
    await editor.focus();
    await editor.press('Control+a');
    await editor.press('Control+b');
    await persistedDocument(page, LONG_TEXT, 1);
    await assertNoLinesInPageGaps(page);
    const longNative = await saveNative(app, page, path.join(output, 'pagination-long.jscript'));
    checkNative(longNative, LONG_TEXT, 1);
    assert.ok(longNative.content.content[0].content.every(node => node.marks?.some(mark => mark.type === 'bold')), 'La selezione attraversa tutte le pagine e formatta il paragrafo completo.');
    await exportFromMenu(app, page, path.join(output, 'pagination-long.docx'), 'docx');
    await checkDocx(page, path.join(output, 'pagination-long.docx'), LONG_TEXT, 1);
    await exportFromMenu(app, page, path.join(output, 'pagination-long.pdf'), 'pdf');

    const previousPages = await page.locator(PAGE_SELECTOR).count();
    await page.getByRole('tab', { name: 'Layout', exact: true }).click();
    await page.getByRole('button', { name: 'Pagina', exact: true }).click();
    await page.getByLabel('Formato pagina', { exact: true }).selectOption('A5');
    await page.getByLabel('Orientamento', { exact: true }).selectOption('landscape');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Margini', exact: true }).click();
    for (const [label, value] of [['Margine superiore', 15], ['Margine destro', 17], ['Margine inferiore', 19], ['Margine sinistro', 21]]) {
      const input = page.getByLabel(label, { exact: true });
      await input.fill(String(value));
      await input.blur();
    }
    await page.keyboard.press('Escape');
    await pageCountAtLeast(page, previousPages + 1);
    await assertNoLinesInPageGaps(page);
    const layoutMetrics = await page.locator('.tiptap').evaluate(element => {
      const style = getComputedStyle(element);
      return Object.fromEntries(['page-width', 'page-height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left']
        .map(name => [name, parseFloat(style.getPropertyValue('--rm-' + name))]));
    });
    for (const [name, value] of Object.entries({ 'page-width': 210, 'page-height': 148, 'margin-top': 15, 'margin-right': 17, 'margin-bottom': 19, 'margin-left': 21 })) {
      assert.ok(Math.abs(layoutMetrics[name] - mmToPx(value)) < 0.2, `${name} aggiornato nel motore di paginazione`);
    }
    const changed = await persistedDocument(page, LONG_TEXT, 1, {
      ...DEFAULT_LAYOUT, pageSize: 'A5', orientation: 'landscape',
      margins: { top: 15, right: 17, bottom: 19, left: 21 },
    });
    assert.equal(changed.layout.pageSize, 'A5');
    assert.equal(changed.layout.orientation, 'landscape');
    assert.deepEqual(changed.layout.margins, { top: 15, right: 17, bottom: 19, left: 21 });
    await page.reload();
    await expect(editor).toContainText(LONG_TEXT);
    await expect(page.locator('.tiptap > p')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await pageCountAtLeast(page, previousPages + 1);
    await assertNoLinesInPageGaps(page);

    const rows = Array.from({ length: 35 }, (_, index) => ({
      type: 'tableRow', content: [0, 1].map(column => ({
        type: index === 0 ? 'tableHeader' : 'tableCell',
        attrs: { colspan: 1, rowspan: 1 },
        content: [paragraph(index === 0 ? `Colonna ${column + 1}` : `Riga ${index}, colonna ${column + 1}: attività e note.`)],
      })),
    }));
    await importFixture(app, page, path.join(output, 'pagination-table-input.jscript'), 'Tabella su più pagine', [
      paragraph('Una tabella che prosegue nella pagina successiva.'), { type: 'table', content: rows }, paragraph('Fine della tabella.'),
    ]);
    await expect(page.locator('.tiptap table tr')).toHaveCount(35);
    await expect(editor).toContainText('Riga 34, colonna 2');
    await pageCountAtLeast(page, 2);
    await assertNoLinesInPageGaps(page, '.tiptap td p, .tiptap th p');
    await screenshotFirstBoundary(page, path.join(output, 'pagination-table.png'));
    assert.deepEqual(errors, [], 'Nessun errore JavaScript durante il flusso multipagina.');
    console.log('Paginazione desktop verificata: 42 Invio, salti reali delle righe, undo/redo, riduzione a una pagina, paragrafo lungo, selezione fra pagine, JSON/DOCX/PDF, layout, riapertura e tabella di 35 righe.');
    console.log('Artefatti: ' + output);
    console.log('Profilo isolato: ' + profile);
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(output, 'pagination-failure.png'), animations: 'disabled' }).catch(() => {});
      const geometry = await lineGeometry(page).catch(() => null);
      console.error('Geometria al fallimento:', JSON.stringify(geometry && {
        gapCount: geometry.gaps.length, lineCount: geometry.lines.length,
        firstGaps: geometry.gaps.slice(0, 3), overlaps: geometry.overlaps.slice(0, 5),
        firstParagraph: geometry.paragraphRects[0], lastParagraph: geometry.paragraphRects.at(-1),
      }));
    }
    throw error;
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});

  }
})().catch(error => { console.error(error); process.exit(1); });
