const { _electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Run after building dist. Every fixture uses a disposable Electron profile and
// the normal native-document import path; the user's documents are never opened.
const CASES = [
  { id: 'letter-85-hanging18', pageSize: 'Letter', margin: 20, indent: -18 },
  { id: 'a4-85-hanging18', pageSize: 'A4', margin: 20, indent: -18 },
  { id: 'letter-85-narrow-hanging18', pageSize: 'Letter', margin: 5, indent: -18 },
  { id: 'a4-85-narrow-hanging100', pageSize: 'A4', margin: 5, indent: -100 },
];
const PAGE_SELECTOR = '.tiptap [data-rm-pagination] > .rm-page-break';
const LONG_TOKEN = 'Lungaparolasenzaspazi'.repeat(75);
const mmToPx = value => value * 96 / 25.4;
const contentText = node => (node.text || '') + (node.content || []).map(contentText).join('');
function paragraph(text, attrs = {}) {
  return { type: 'paragraph', attrs: { wordBefore: 0, wordAfter: 0, wordLinePt: 15,
    wordFontFamily: 'Arial', wordFontSize: 12, ...attrs },
    content: [{ type: 'text', text }] };
}
function fixture(testCase) {
  const layout = { pageSize: testCase.pageSize, orientation: 'portrait',
    margins: { top: 20, right: testCase.margin, bottom: 20, left: testCase.margin },
    lineSpacing: 1.25, paragraphBefore: 0, paragraphAfter: 0 };
  // Fixed 15pt line boxes place the list's first items exactly at a page edge.
  // Ordinary text in the filler avoids the empty-paragraph table display rule.
  const pageHeight = mmToPx(testCase.pageSize === 'Letter' ? 279.4 : 297);
  const usableHeight = pageHeight - mmToPx(layout.margins.top + layout.margins.bottom);
  const fillerCount = Math.max(1, Math.floor(usableHeight / 20) - 1);
  const hanging = { wordIndentLeft: Math.abs(testCase.indent) + 18,
    wordIndentFirst: testCase.indent, wordIndentRight: 0 };
  const items = Array.from({ length: 44 }, (_, index) => ({ type: 'listItem', content: [
    paragraph(`Elemento ${index + 1}: questa frase verifica il passaggio corretto fra le pagine e mantiene intere le parole.`, hanging),
  ] }));
  // One item itself spans multiple pages. This guards against fixing the bug by
  // creating a formatting context around each paragraph or disabling wrapping.
  items.push({ type: 'listItem', content: [paragraph(LONG_TOKEN.repeat(2), hanging)] });
  items.push({ type: 'listItem', content: [paragraph('Conclusione della verifica dei rientri.', hanging)] });
  return { format: 'jscript', version: 1, title: testCase.id, layout,
    updatedAt: new Date(0).toISOString(), content: { type: 'doc', content: [
      ...Array.from({ length: fillerCount }, (_, index) => paragraph(`Preparazione ${index + 1}`)),
      { type: 'bulletList', content: items },
    ] } };
}
async function settled(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function importFixture(app, page, filename, value) {
  await fs.writeFile(filename, JSON.stringify(value), 'utf8');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, filename);
  await page.getByRole('button', { name: /Apri dal computer/ }).click();
  await expect(page.getByLabel('Titolo del documento', { exact: true })).toHaveValue(value.title);
  await expect(page.locator('.tiptap li')).toHaveCount(46);
  await expect.poll(() => page.locator(PAGE_SELECTOR).count()).toBeGreaterThanOrEqual(3);
  await settled(page);
  await page.getByLabel('Titolo del documento', { exact: true }).focus();
}
async function glyphGeometry(page) {
  return page.evaluate(() => {
    const editor = document.querySelector('.tiptap');
    const rect = value => ({ top: value.top, bottom: value.bottom, left: value.left,
      right: value.right, width: value.width, height: value.height });
    const exclusions = [...editor.querySelectorAll('.rm-page-break > .breaker')]
      .map(element => rect(element.getBoundingClientRect())).filter(value => value.height > 0);
    const editorRect = editor.getBoundingClientRect();
    const scale = editorRect.width / editor.offsetWidth;
    const paragraphs = [...editor.querySelectorAll('li > p')];
    const overlapSamples = [], horizontalSamples = [];
    let overlaps = 0, horizontalOverflow = 0, glyphCount = 0;
    const paragraphStats = paragraphs.map((element, paragraphIndex) => {
      const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
      const minimumLeft = bounds.left + Math.min(0, parseFloat(style.textIndent) || 0) * scale;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let node, first = null, last = null, lines = new Set();
      while ((node = walker.nextNode())) {
        for (let offset = 0; offset < node.length; offset++) {
          if (/\s/.test(node.data[offset])) continue;
          range.setStart(node, offset); range.setEnd(node, offset + 1);
          // Use individual glyph rectangles: a paragraph or span's union box can
          // span the entire page gap while hiding a tiny fragment at its edge.
          for (const raw of range.getClientRects()) {
            if (!raw.width || !raw.height) continue;
            const glyph = rect(raw); glyphCount++; first ||= glyph; last = glyph;
            lines.add(Math.round(raw.top * 10) / 10);
            const gapIndex = exclusions.findIndex(gap =>
              Math.min(glyph.bottom, gap.bottom) - Math.max(glyph.top, gap.top) > 1);
            if (gapIndex !== -1) {
              overlaps++;
              if (overlapSamples.length < 12) overlapSamples.push({ paragraphIndex, offset,
                character: node.data[offset], glyph, gapIndex, gap: exclusions[gapIndex] });
            }
            if (glyph.right > bounds.right + 1.5 || glyph.left < minimumLeft - 1.5) {
              horizontalOverflow++;
              if (horizontalSamples.length < 8) horizontalSamples.push({ paragraphIndex, offset,
                character: node.data[offset], glyph, minimumLeft, rightLimit: bounds.right });
            }
          }
        }
      }
      return { paragraphIndex, first, last, lines: lines.size,
        textIndent: style.textIndent, bounds: rect(bounds) };
    });
    return { glyphCount, overlaps, overlapSamples, horizontalOverflow, horizontalSamples,
      exclusions, paragraphStats, zoom: getComputedStyle(editor.closest('.page-stack')).zoom,
      overflowWrap: getComputedStyle(editor).overflowWrap };
  });
}
async function boundaryScreenshot(page, filename) {
  await page.locator('.editor-scroll').evaluate(element => {
    const gap = element.querySelector('.rm-pagination-gap');
    const bounds = element.getBoundingClientRect();
    element.scrollTop += gap.getBoundingClientRect().top - bounds.top - bounds.height * .4;
  });
  await settled(page);
  await page.screenshot({ path: filename, animations: 'disabled', timeout: 5000 });
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-results', 'pagination-hanging-indent');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'jscript-hanging-indent-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; delete env.JSCRIPT_DEV;
  const packaged = process.argv[2] || process.env.JSCRIPT_TEST_EXECUTABLE;
  const app = await _electron.launch({
    executablePath: packaged || path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [...(packaged ? [] : [root]), '--user-data-dir=' + profile], env, timeout: 30000,
  });
  const results = [], errors = [];
  let page;
  try {
    page = await app.firstWindow(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', { name: /Apri dal computer/ }).waitFor();
    for (const testCase of CASES) {
      const value = fixture(testCase);
      await importFixture(app, page, path.join(output, testCase.id + '.jscript'), value);
      await expect(page.locator('.zoom-value')).toHaveText('85%');
      // Measure twice across a frame to avoid accepting transient pre-reflow DOM.
      await glyphGeometry(page); await settled(page);
      const geometry = await glyphGeometry(page);
      const result = { ...testCase, geometry };
      results.push(result);
      await fs.writeFile(path.join(output, testCase.id + '.json'), JSON.stringify(result, null, 2));
      await boundaryScreenshot(page, path.join(output, testCase.id + '.png'));
      const readSaved = () => page.evaluate(async () => {
        const workspace = await window.jscript.loadAutosave();
        return workspace?.documents?.find(document => document.id === workspace.activeId);
      });
      await expect.poll(async () => (await readSaved())?.title).toBe(value.title);
      const saved = await readSaved();
      assert.equal(contentText(saved.content), contentText(value.content));
      const list = saved.content.content.find(node => node.type === 'bulletList');
      assert.ok(list.content.every(item => item.content[0].attrs.wordIndentFirst === testCase.indent), 'Native save preserves hanging indent');
      console.log(`${testCase.id}: ${geometry.glyphCount} glyphs, ${geometry.exclusions.length} pages, ` +
        `${geometry.overlaps} in page exclusions, ${geometry.horizontalOverflow} outside paragraph width`);
    }
    for (const { id, indent, geometry } of results) {
      assert.equal(Number(geometry.zoom), .85, id + ': tested at 85% zoom');
      assert.ok(geometry.glyphCount > 5000, id + ': measured real text glyphs');
      assert.equal(parseFloat(geometry.paragraphStats[0].textIndent), 0,
        id + ': list body does not repeat its marker hanging indent');
      assert.equal(geometry.overlaps, 0,
        id + ': no characters may appear beside footer/header floats; ' + JSON.stringify(geometry.overlapSamples));
      assert.equal(geometry.horizontalOverflow, 0,
        id + ': long tokens must wrap within the paragraph; ' + JSON.stringify(geometry.horizontalSamples));
      const longParagraph = geometry.paragraphStats.at(-2);
      assert.ok(longParagraph.lines > 25, id + ': long token wraps across many lines');
      assert.ok(geometry.exclusions.some(gap => longParagraph.first.bottom <= gap.top + 1 &&
        longParagraph.last.top >= gap.bottom - 1), id + ': the same long paragraph continues across pages');
    }
    assert.deepEqual(errors, [], 'No JavaScript errors during hanging-indent pagination');
    console.log('Hanging-indent pagination regression passed. Artifacts: ' + output);
  } finally {
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, errors, profile }, null, 2));
    // A dirty document invokes the close-confirmation dialog on app.close().
    // This test owns an isolated disposable profile, so exit the process directly.
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });