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
const NUMBER_FIELDS = [
  { label: 'Margine superiore', key: 'top', min: 5, max: 50, initial: 20, draft: 18.4 },
  { label: 'Margine inferiore', key: 'bottom', min: 5, max: 50, initial: 20, draft: 19.4 },
  { label: 'Margine sinistro', key: 'left', min: 5, max: 50, initial: 20, draft: 21.4 },
  { label: 'Margine destro', key: 'right', min: 5, max: 50, initial: 20, draft: 22.4 },
  { label: 'Interlinea', key: 'lineSpacing', min: 1, max: 3, initial: 1.7, draft: 1.8 },
  { label: 'Spazio prima', key: 'paragraphBefore', min: 0, max: 48, initial: 0, draft: 3.4 },
  { label: 'Spazio dopo', key: 'paragraphAfter', min: 0, max: 48, initial: 10.8, draft: 8.4 },
];
const COLUMN_SELECTOR = '.tiptap .jscript-columns';
const PAGE_SELECTOR = '.tiptap [data-rm-pagination] > .rm-page-break';
const CV_TITLE = 'Curriculum - Giulia Rossi';
const LEFT_TEXT = ['GIULIA ROSSI', 'Frontend developer', 'Milano · giulia@example.test'];
const RIGHT_TEXT = ['PROFILO', 'Sviluppo interfacce accessibili con React e TypeScript.'];
const SPLIT_BEFORE = 'Progetti web · ';
const SPLIT_AFTER = 'Formazione continua';
const rounded = value => Math.round(value * 100) / 100;
const paragraph = text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
const textOf = node => (node?.text || '') + (node?.content || []).map(textOf).join('');
const tableRows = table => (table?.content || []).flatMap(node => node.type === 'tableRowGroup' ? node.content : node.type === 'tableRow' ? [node] : []);
const columnsTable = document => document?.content?.content?.find(node => node.type === 'table' && node.attrs?.layout === 'columns');

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

async function clickButton(page, name) {
  if (['Due uguali', 'Laterale stretta', 'Aggiungi sezione', 'Dividi dal cursore', 'Torna a una colonna'].includes(name)) await openGroup(page, 'Colonne');
  if (name === 'Ripristina layout') await openGroup(page, 'Pagina');
  const button = page.getByRole('button', { name, exact: true });
  await button.scrollIntoViewIfNeeded();
  await button.click();
}

async function openLayout(page) {
  await page.getByRole('tab', { name: 'Layout', exact: true }).click();
  await expect(page.locator('.layout-panel')).toBeVisible();
}

async function readDocument(page) {
  return page.evaluate(async () => {
    const workspace = await window.jscript.loadAutosave();
    return workspace?.documents?.find(document => document.id === workspace.activeId);
  });
}

async function persisted(page, title, project, expected) {
  await expect.poll(async () => {
    const document = await readDocument(page);
    return document?.title === title ? project(document) : null;
  }, { timeout: 15000, message: 'La bozza attiva deve conservare titolo, contenuti e impostazioni aggiornati.' }).toEqual(expected);
  await expect(page.getByText('Bozza salvata sul dispositivo', { exact: true })).toBeVisible();
  return readDocument(page);
}

async function setNumber(page, label, value) {
  await openGroup(page, label.startsWith('Margine') ? 'Margini' : 'Spaziatura');
  const input = page.getByLabel(label, { exact: true });
  await input.fill(String(value));
  await input.blur();
  await expect(input).toHaveValue(String(value));
}

async function assertReadableLayout(page) {
  const controls = [];
  for (const group of ['Pagina', 'Margini', 'Spaziatura']) {
    await openGroup(page, group);
    await settled(page);
    controls.push(...await page.getByRole('dialog', { name: group, exact: true }).evaluate(panel =>
      [...panel.querySelectorAll('.layout-field input, .layout-field select')].map(control => {
        const field = control.closest('.layout-field');
        return {
          name: control.getAttribute('aria-label'),
          controlFont: parseFloat(getComputedStyle(control).fontSize),
          labelFont: parseFloat(getComputedStyle(field.querySelector(':scope > label, :scope > span')).fontSize),
        };
      })));
  }
  assert.equal(controls.length, 10, 'Tre selettori e sette campi numerici nei gruppi layout.');
  for (const metric of controls) {
    assert.ok(metric.labelFont >= 10, `${metric.name}: etichetta leggibile di almeno 10 px.`);
    assert.ok(metric.controlFont >= 10, `${metric.name}: valore leggibile di almeno 10 px.`);
  }
  await expect(page.locator('.layout-stepper button')).toHaveCount(14);
  for (const field of NUMBER_FIELDS) {
    await openGroup(page, field.label.startsWith('Margine') ? 'Margini' : 'Spaziatura');
    const lower = field.label.toLocaleLowerCase('it-IT');
    await expect(page.getByRole('button', { name: `Aumenta ${lower}`, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `Diminuisci ${lower}`, exact: true })).toBeVisible();
  }
  await page.keyboard.press('Escape');
}

async function checkSteppers(page, title) {
  const expected = structuredClone(DEFAULT_LAYOUT);
  for (const field of NUMBER_FIELDS) {
    const input = page.getByLabel(field.label, { exact: true });
    const lower = field.label.toLocaleLowerCase('it-IT');
    const increase = page.getByRole('button', { name: `Aumenta ${lower}`, exact: true });
    const decrease = page.getByRole('button', { name: `Diminuisci ${lower}`, exact: true });
    await setNumber(page, field.label, field.initial);
    await increase.click();
    await expect(input).toHaveValue(String(rounded(field.initial + .1)));
    await decrease.click();
    await expect(input).toHaveValue(String(field.initial));
    await setNumber(page, field.label, field.max);
    await expect(increase).toBeDisabled();
    await decrease.click();
    await expect(input).toHaveValue(String(rounded(field.max - .1)));
    await setNumber(page, field.label, field.min);
    await expect(decrease).toBeDisabled();
    await increase.click();
    await expect(input).toHaveValue(String(rounded(field.min + .1)));

    // A pending manual draft is incremented exactly once, without blur first
    // committing a stale value or the click applying a second increment.
    await input.fill(String(field.draft).replace('.', ','));
    await expect(input).toHaveAttribute('aria-valuenow', String(rounded(field.min + .1)));
    await increase.click();
    const committed = rounded(field.draft + .1);
    await expect(input).toHaveValue(String(committed));
    await input.blur();
    await expect(input).toHaveValue(String(committed));
    await input.press('ArrowUp');
    await expect(input).toHaveValue(String(rounded(committed + .1)));
    await input.press('ArrowDown');
    await expect(input).toHaveValue(String(committed));
    await input.press('Enter');
    if (field.key in expected.margins) expected.margins[field.key] = committed;
    else expected[field.key] = committed;
    await persisted(page, title, document => document.layout, expected);
  }
  await page.reload();
  await expect(page.getByLabel('Titolo del documento', { exact: true })).toHaveValue(title);
  await openLayout(page);
  for (const field of NUMBER_FIELDS) {
    const value = field.key in expected.margins ? expected.margins[field.key] : expected[field.key];
    await expect(page.getByLabel(field.label, { exact: true })).toHaveValue(String(value));
  }
  await clickButton(page, 'Ripristina layout');
  await persisted(page, title, document => document.layout, DEFAULT_LAYOUT);
}

async function typeParagraphs(page, cell, lines) {
  await cell.locator('p').first().click();
  for (let index = 0; index < lines.length; index++) {
    if (index) await page.keyboard.press('Enter');
    await page.keyboard.insertText(lines[index]);
  }
}

async function assertColumnRatio(page, expectedRatio) {
  await expect.poll(async () => {
    const cells = page.locator(COLUMN_SELECTOR).first().locator('tr').first().locator('td');
    return cells.evaluateAll(elements => {
      if (elements.length !== 2) return null;
      return elements[0].getBoundingClientRect().width / elements[1].getBoundingClientRect().width;
    });
  }, { timeout: 10000, message: 'Le due colonne devono avere la proporzione richiesta anche nella vista.' }).toBeCloseTo(expectedRatio, 1);
}

async function directSaveTo(app, filename) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, filename);
}

async function saveNative(app, page, filename) {
  await directSaveTo(app, filename);
  await clickButton(page, 'Salva copia');
  await page.getByText('Documento JScript salvato.', { exact: true }).waitFor();
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}

async function exportDocument(app, page, filename, format) {
  await directSaveTo(app, filename);
  await clickButton(page, 'Opzioni di esportazione');
  await clickButton(page, format === 'docx' ? 'Esporta Word (.docx)' : 'Esporta PDF');
  await page.getByText(format === 'docx' ? 'Documento Word esportato.' : 'PDF salvato.', { exact: format !== 'docx' }).waitFor({ timeout: 30000 });
  const bytes = await fs.readFile(filename);
  assert.equal(bytes.subarray(0, format === 'docx' ? 2 : 4).toString(), format === 'docx' ? 'PK' : '%PDF');
  assert.ok(bytes.length > 1000, 'Il documento esportato contiene dati.');
}

async function checkDocxColumns(page, filename, expectedText, expectedRows) {
  const mammothRequire = createRequire(require.resolve('mammoth'));
  const JSZip = mammothRequire('jszip');
  const archive = await JSZip.loadAsync(await fs.readFile(filename));
  const xml = await archive.file('word/document.xml').async('string');
  const parsed = await page.evaluate(xml => {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const table = document.getElementsByTagName('w:tbl')[0];
    if (!table) return null;
    return {
      parseErrors: document.getElementsByTagName('parsererror').length,
      text: [...document.getElementsByTagName('w:t')].map(node => node.textContent).join(''),
      tableCount: document.getElementsByTagName('w:tbl').length,
      widths: [...table.getElementsByTagName('w:gridCol')].map(node => Number(node.getAttribute('w:w'))),
      rows: [...table.getElementsByTagName('w:tr')].map(row => row.getElementsByTagName('w:tc').length),
      borders: [...table.getElementsByTagName('w:tblBorders')].flatMap(node => [...node.children].map(border => border.getAttribute('w:val'))),
    };
  }, xml);
  assert.ok(parsed, 'Il DOCX conserva le colonne come tabella senza bordi.');
  assert.equal(parsed.parseErrors, 0);
  assert.equal(parsed.tableCount, 1);
  assert.equal(parsed.text, expectedText, 'Tutti i testi del CV sono nel DOCX.');
  assert.deepEqual(parsed.rows, Array(expectedRows).fill(2), 'Ogni sezione mantiene due celle indipendenti.');
  assert.equal(parsed.widths.length, 2);
  assert.ok(Math.abs(parsed.widths[0] / parsed.widths[1] - .5) < .01, 'Il DOCX conserva la proporzione laterale 1:2.');
  assert.ok(parsed.borders.length > 0 && parsed.borders.every(value => ['none', 'nil'].includes(value)), 'Il layout esportato non ha bordi da tabella dati.');
  assert.ok(!/rm-pagination|data-rm-pagination|rm-page-break/.test(xml), 'Le decorazioni della paginazione non entrano nel DOCX.');
}

async function importNative(app, page, filename, title) {
  const previousId = (await readDocument(page))?.id;
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, filename);
  await page.getByRole('button', { name: /Apri dal computer/ }).click();
  await expect(page.getByLabel('Titolo del documento', { exact: true })).toHaveValue(title);
  await expect.poll(async () => (await readDocument(page))?.id, { timeout: 15000 }).not.toBe(previousId);
}

async function assertNoTextInPageBreaks(page) {
  await expect.poll(() => page.locator(PAGE_SELECTOR).count(), { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  const measure = () => page.evaluate(() => {
    const editor = document.querySelector('.tiptap');
    const bounds = element => {
      const rectangle = element.getBoundingClientRect();
      return { top: rectangle.top, bottom: rectangle.bottom, height: rectangle.height };
    };
    const gaps = [...editor.querySelectorAll('.rm-pagination-gap')]
      .filter(element => getComputedStyle(element).display !== 'none').map(bounds).filter(rectangle => rectangle.height > 0);
    const exclusions = [...editor.querySelectorAll('.rm-page-break > .breaker')].map(bounds).filter(rectangle => rectangle.height > 0);
    const lines = [...editor.querySelectorAll('.jscript-columns td p')].flatMap(paragraph => {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const rectangles = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const rectangle of range.getClientRects()) if (rectangle.height > 0 && rectangle.width > 0) rectangles.push({ top: rectangle.top, bottom: rectangle.bottom });
      }
      return rectangles;
    });
    const overlaps = lines.flatMap((line, index) => exclusions.flatMap((gap, gapIndex) => {
      const amount = Math.min(line.bottom, gap.bottom) - Math.max(line.top, gap.top);
      return amount > 1 ? [{ index, gapIndex, amount, line, gap }] : [];
    }));
    return { gaps, lines: lines.length, overlaps };
  });
  await expect.poll(async () => (await measure()).overlaps.length, {
    timeout: 15000, message: 'Le sezioni affiancate non devono avere testo nei margini o negli intervalli fra pagine.',
  }).toBe(0);
  const geometry = await measure();
  assert.ok(geometry.gaps.length > 0 && geometry.lines >= 70, 'Misurati tutti i testi e almeno un salto pagina.');
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-results');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'jscript-columns-test-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.JSCRIPT_DEV;
  const packaged = process.env.JSCRIPT_TEST_EXECUTABLE;
  const app = await _electron.launch({
    executablePath: packaged || path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [...(packaged ? [] : [root]), '--user-data-dir=' + profile], env, timeout: 30000,
  });
  const errors = [];
  let page;
  try {
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1486, 973));
    await page.getByText('Da dove cominciamo?', { exact: true }).waitFor();
    await clickButton(page, 'Nuovo documento');
    await page.getByLabel('Titolo del documento', { exact: true }).fill(CV_TITLE);
    const editor = page.getByRole('textbox', { name: 'Contenuto del documento', exact: true });
    await openLayout(page);
    await persisted(page, CV_TITLE, document => document.layout, DEFAULT_LAYOUT);
    await assertReadableLayout(page);
    await page.screenshot({ path: path.join(output, 'columns-layout-light.png'), animations: 'disabled' });
    await clickButton(page, 'Cambia tema');
    await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
    await assertReadableLayout(page);
    await page.screenshot({ path: path.join(output, 'columns-layout-dark.png'), animations: 'disabled' });
    await clickButton(page, 'Cambia tema');
    await checkSteppers(page, CV_TITLE);

    await clickButton(page, 'Due uguali');
    await expect(page.locator(COLUMN_SELECTOR)).toHaveCount(1);
    const block = page.locator(COLUMN_SELECTOR).first();
    await expect(block.locator('tr')).toHaveCount(1);
    await expect(block.locator('td')).toHaveCount(2);
    await typeParagraphs(page, block.locator('td').nth(0), LEFT_TEXT);
    await typeParagraphs(page, block.locator('td').nth(1), RIGHT_TEXT);
    await expect(block.locator('td').nth(0)).toContainText(LEFT_TEXT.join(''));
    await expect(block.locator('td').nth(0)).not.toContainText(RIGHT_TEXT[0]);
    await expect(block.locator('td').nth(1)).toContainText(RIGHT_TEXT.join(''));
    await expect(block.locator('td').nth(1)).not.toContainText(LEFT_TEXT[0]);
    const originalText = LEFT_TEXT.join('') + RIGHT_TEXT.join('');
    await persisted(page, CV_TITLE, document => ({ text: textOf(document.content), ratio: columnsTable(document)?.attrs?.columnSize }), { text: originalText, ratio: '50,50' });
    await assertColumnRatio(page, 1);

    // ProseMirror groups adjacent changes for 500 ms. Keep the ratio command
    // separate from typing so undo/redo must preserve both cell contents.
    await page.waitForTimeout(600);
    await clickButton(page, 'Laterale stretta');
    await assertColumnRatio(page, .5);
    await editor.press('Control+z');
    await assertColumnRatio(page, 1);
    await expect(editor).toContainText(LEFT_TEXT[0]);
    await expect(editor).toContainText(RIGHT_TEXT[1]);
    await editor.press('Control+y');
    await assertColumnRatio(page, .5);
    await persisted(page, CV_TITLE, document => ({ text: textOf(document.content), ratio: columnsTable(document)?.attrs?.columnSize }), { text: originalText, ratio: '33.333,66.667' });

    await clickButton(page, 'Aggiungi sezione');
    await expect(block.locator('tr')).toHaveCount(2);
    const second = block.locator('tr').nth(1);
    await typeParagraphs(page, second.locator('td').nth(0), ['COMPETENZE']);
    await typeParagraphs(page, second.locator('td').nth(1), [SPLIT_BEFORE + SPLIT_AFTER]);
    await second.locator('td').nth(1).locator('p').evaluate((element, offset) => {
      element.closest('.tiptap').focus();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      walker.nextNode();
      const range = document.createRange();
      range.setStart(walker.currentNode, offset);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    }, SPLIT_BEFORE.length);
    await openGroup(page, 'Colonne');
    await expect(page.getByRole('button', { name: 'Dividi dal cursore', exact: true })).toBeEnabled();
    await clickButton(page, 'Dividi dal cursore');
    await expect(block.locator('tr')).toHaveCount(3);
    await expect(block.locator('tr').nth(1).locator('td').nth(1)).toHaveText(SPLIT_BEFORE.trim());
    await expect(block.locator('tr').nth(2).locator('td').nth(1)).toHaveText(SPLIT_AFTER);
    const cvText = originalText + 'COMPETENZE' + SPLIT_BEFORE + SPLIT_AFTER;
    const saved = await persisted(page, CV_TITLE, document => ({
      text: textOf(document.content), rows: tableRows(columnsTable(document)).length,
      ratio: columnsTable(document)?.attrs?.columnSize,
    }), { text: cvText, rows: 3, ratio: '33.333,66.667' });
    assert.ok(tableRows(columnsTable(saved)).every(row => row.content.length === 2));

    const nativePath = path.join(output, 'columns.jscript');
    const native = await saveNative(app, page, nativePath);
    assert.equal(native.format, 'jscript');
    assert.equal(textOf(native.content), cvText);
    assert.deepEqual(native.layout, DEFAULT_LAYOUT);
    assert.equal(columnsTable(native).attrs.columnSize, '33.333,66.667');
    assert.equal(tableRows(columnsTable(native)).length, 3);
    await exportDocument(app, page, path.join(output, 'columns.docx'), 'docx');
    await checkDocxColumns(page, path.join(output, 'columns.docx'), cvText, 3);
    await exportDocument(app, page, path.join(output, 'columns.pdf'), 'pdf');
    await importNative(app, page, nativePath, CV_TITLE);
    await expect(page.locator(COLUMN_SELECTOR)).toHaveCount(1);
    await expect(page.locator(COLUMN_SELECTOR).locator('tr')).toHaveCount(3);
    await assertColumnRatio(page, .5);
    await persisted(page, CV_TITLE, document => textOf(document.content), cvText);
    await page.getByRole('tab', { name: 'Scrittura', exact: true }).click();
    await page.getByLabel('Titolo del documento', { exact: true }).click();
    await page.locator('.editor-scroll').evaluate(element => { element.scrollTop = 0; });
    await settled(page);
    await page.screenshot({ path: path.join(output, 'columns-cv.png'), animations: 'disabled' });

    const fixtureTitle = 'Trentacinque sezioni affiancate';
    const rows = Array.from({ length: 35 }, (_, index) => ({
      type: 'tableRow', content: [0, 1].map(column => ({
        type: 'tableCell', attrs: { colspan: 1, rowspan: 1 },
        content: [paragraph(column === 0
          ? `Sezione ${index + 1}: competenze e attività.`
          : `Esperienza ${index + 1}: sviluppo di interfacce accessibili, collaborazione e progetti verificati.`)],
      })),
    }));
    const fixture = { format: 'jscript', version: 1, title: fixtureTitle, layout: DEFAULT_LAYOUT,
      content: { type: 'doc', content: [{ type: 'table', attrs: { layout: 'columns', columnSize: '33.333,66.667' }, content: rows }] } };
    const fixturePath = path.join(output, 'columns-many-input.jscript');
    await fs.writeFile(fixturePath, JSON.stringify(fixture), 'utf8');
    await importNative(app, page, fixturePath, fixtureTitle);
    await expect(page.locator(COLUMN_SELECTOR).locator('tr')).toHaveCount(35);
    await expect(editor).toContainText('Esperienza 35:');
    const allText = textOf(fixture.content);
    await persisted(page, fixtureTitle, document => textOf(document.content), allText);
    await assertNoTextInPageBreaks(page);
    await page.getByLabel('Titolo del documento', { exact: true }).click();
    await page.locator('.editor-scroll').evaluate(element => {
      const gap = element.querySelector('.rm-pagination-gap');
      const bounds = element.getBoundingClientRect();
      element.scrollTop += gap.getBoundingClientRect().top - bounds.top - bounds.height * .35;
    });
    await settled(page);
    await page.screenshot({ path: path.join(output, 'columns-pages.png'), animations: 'disabled' });
    await page.locator(COLUMN_SELECTOR).locator('td p').first().click();
    await openLayout(page);
    await clickButton(page, 'Torna a una colonna');
    await expect(page.locator(COLUMN_SELECTOR)).toHaveCount(0);
    // TipTap may retain its empty trailing paragraph after the original table.
    // The 35 sections must still unwrap into exactly 70 nonempty text blocks.
    await expect.poll(() => page.locator('.tiptap > p').evaluateAll(paragraphs =>
      paragraphs.filter(paragraph => paragraph.textContent.trim().length > 0).length
    )).toBe(70);
    await persisted(page, fixtureTitle, document => ({ text: textOf(document.content), tables: document.content.content.filter(node => node.type === 'table').length }), { text: allText, tables: 0 });
    assert.deepEqual(errors, [], 'Nessun errore JavaScript durante il flusso colonne.');
    console.log('Colonne desktop verificate: caratteri 10 px, sette stepper, limiti/draft/tastiera/autosalvataggio, CV indipendente, proporzioni e undo/redo, sezioni e divisione, JSON/DOCX/PDF, reimportazione, 35 sezioni paginate e ritorno a una colonna senza perdita.');
    console.log('Artefatti: ' + output);
    console.log('Profilo isolato: ' + profile);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'columns-failure.png'), animations: 'disabled' }).catch(() => {});
    throw error;
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch(error => { console.error(error); process.exit(1); });
