import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { Window } from 'happy-dom'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKitPlus } from 'tiptap-table-plus'
import { WordFormatting, sanitizeWordAttributes, paragraphStyle, cellStyle } from '../src/lib/word-format'
import { validateNativeDocument, importDocument, toDocx } from '../src/lib/documents'
import { TextStyleKit } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import { ColumnSections } from '../src/lib/columns'
import { paginationExtension } from '../src/lib/pagination'
import { createWordFixture } from './create-word-fixture'
import JSZip from 'jszip'

const browser = new Window({ url: 'https://jscript-preview.test/' })
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLTableElement', 'HTMLTableCellElement', 'DOMParser', 'MutationObserver', 'ResizeObserver', 'NodeFilter', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'] as const) {
  const value = key === 'window' ? browser : key === 'getComputedStyle' || key === 'requestAnimationFrame' || key === 'cancelAnimationFrame'
    ? (browser[key] as Function).bind(browser) : browser[key as keyof Window]
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
after(async () => { await browser.happyDOM.abort() })

function create(content: JSONContent | string): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return new Editor({ element, extensions: [StarterKit, TableKitPlus, WordFormatting], content })
}
function parsed(html: string): HTMLDivElement {
  const element = document.createElement('div'); element.innerHTML = html; return element
}
function native(content: JSONContent) {
  return validateNativeDocument(JSON.stringify({ format: 'jscript', version: 1, title: 'Word', content })).content
}
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })

test('Word paragraph and blank-line formatting survive Editor JSON, HTML and native reopen', () => {
  const attributes = { wordBefore: 0, wordAfter: 6, wordLine: 1.15, wordIndentLeft: 18, wordIndentRight: 9, wordIndentFirst: -9, wordFontFamily: 'Times New Roman', wordFontSize: 11, wordKeepNext: true }
  const content = native({ type: 'doc', content: [
    { ...paragraph('Imported paragraph'), attrs: attributes },
    { type: 'heading', attrs: { level: 2, wordBefore: 12, wordAfter: 4, wordFontFamily: 'Arial', wordFontSize: 16, wordLine: 1 }, content: [{ type: 'text', text: 'Styled heading', marks: [{ type: 'bold' }] }] },
    { type: 'paragraph', attrs: { wordBefore: 0, wordAfter: 0, wordLinePt: 10, wordFontSize: 9, wordFontFamily: 'Arial' } },
  ] })
  const editor = create(content)
  try {
    const json = editor.getJSON()
    assert.deepEqual(sanitizeWordAttributes('paragraph', json.content![0].attrs), sanitizeWordAttributes('paragraph', attributes))
    assert.equal(json.content![2].attrs!.wordFontSize, 9)
    const html = parsed(editor.getHTML())
    const p = html.querySelector('p')!
    assert.equal(p.dataset.wordFormat, 'true')
    assert.equal(p.style.marginTop, '0pt'); assert.equal(p.style.marginBottom, '6pt')
    assert.equal(p.style.textIndent, '-9pt'); assert.equal(p.style.lineHeight, '1.15')
    assert.equal(p.style.fontSize, '11pt'); assert.equal(p.style.breakAfter, 'avoid')
    assert.equal(html.querySelector('h2')!.style.fontWeight, '400')
    assert.equal(html.querySelector('h2')!.querySelector('strong')!.textContent, 'Styled heading')
    assert.equal(html.querySelectorAll('p')[1].style.lineHeight, '10pt')
    editor.commands.setContent(native(json))
    assert.equal(editor.getJSON().content![0].attrs!.wordAfter, 6)
    editor.commands.setContent(editor.getHTML())
    assert.equal(editor.getJSON().content![0].attrs!.wordIndentFirst, -9)
    assert.equal(editor.getJSON().content![2].attrs!.wordLinePt, 10)
  } finally { editor.destroy() }
})

test('Word attributes reject nonnumeric values and CSS injection without adding defaults to old documents', () => {
  assert.deepEqual(sanitizeWordAttributes('paragraph', { wordBefore: -1, wordAfter: Infinity, wordFontSize: '12', wordFontFamily: 'Arial; background:url(https://example.com)', wordKeepNext: 1 }), {})
  assert.deepEqual(sanitizeWordAttributes('table', { wordWidth: 101, wordAlign: ['left'], wordIndent: -1 }), {})
  assert.deepEqual(sanitizeWordAttributes('tableCell', { wordFill: 'url(x)', wordVAlign: ['top'], wordBorderTop: '1pt solid #000000;display:none', wordBorderLeft: '300pt solid #000000', wordPaddingLeft: -1 }), {})
  const content = native({ type: 'doc', content: [{ ...paragraph('Safe text'), attrs: { wordBefore: 0, wordAfter: -4, wordLine: 1.5, wordLinePt: 18, wordFontFamily: 'Arial; color:red', onclick: 'alert(1)' } }] })
  assert.deepEqual(content.content![0].attrs, { wordBefore: 0, wordLinePt: 18 })
  const editor = create(content)
  try {
    assert.doesNotMatch(editor.getHTML(), /onclick|color:red|url\(/)
    assert.match(editor.getHTML(), /line-height:\s*18pt/)
    editor.commands.setContent({ type: 'doc', content: [paragraph('Existing document')] })
    assert.doesNotMatch(editor.getHTML(), /data-word-format|line-height|margin-top|font-family/)
  } finally { editor.destroy() }
  assert.match(paragraphStyle({ wordFontSize: 11 }, 'heading'), /font-weight:400/)
  assert.equal(cellStyle({ wordBorderBottom: '0pt none #000000' }), 'border-bottom:0pt none #000000 !important')
})

test('TablePlus initial node views and updates show imported widths, fill, borders and padding', () => {
  const editor = create(native({ type: 'doc', content: [{ type: 'table', attrs: { wordWidth: 70, wordAlign: 'right', columnSize: '30,70' }, content: [{ type: 'tableRow', content: [
    { type: 'tableCell', attrs: { wordFill: '#ABCDEF', wordVAlign: 'middle', wordBorderTop: '1.5pt solid #123456', wordPaddingLeft: 6 }, content: [paragraph('A')] },
    { type: 'tableCell', content: [paragraph('B')] },
  ] }] }] }))
  try {
    const table = editor.view.nodeDOM(0) as HTMLElement
    assert.equal(table.style.width, '70%'); assert.equal(table.style.marginLeft, 'auto')
    const cell = editor.view.nodeDOM(2) as HTMLElement
    assert.equal(cell.dataset.wordFormat, 'true'); assert.equal(cell.dataset.wordValign, 'middle')
    assert.match(cell.style.backgroundColor, /#abcdef|rgb\(171, 205, 239\)/i)
    assert.equal(cell.style.paddingLeft, '6pt')
    // happy-dom loses shorthand priority while combining cssText with the
    // TablePlus border shorthand; width/color still verify the live decoration.
    assert.equal(cell.style.borderTopWidth, '1.5pt')
    const initial = editor.state.doc.nodeAt(2)!
    editor.view.dispatch(editor.state.tr.setNodeMarkup(2, undefined, { ...initial.attrs, wordFill: '#112233', wordPaddingLeft: 0 }))
    const updated = editor.view.nodeDOM(2) as HTMLElement
    assert.match(updated.style.backgroundColor, /#112233|rgb\(17, 34, 51\)/i)
    assert.equal(updated.style.paddingLeft, '0pt')
    const output = parsed(editor.getHTML())
    assert.equal(output.querySelector('table')!.style.width, '70%')
    assert.equal(output.querySelector('td')!.style.getPropertyPriority('border-top'), 'important')
    assert.match(output.querySelector('td')!.style.backgroundColor, /#112233|rgb\(17, 34, 51\)/i)
    editor.view.dispatch(editor.state.tr.setNodeMarkup(2, undefined, { ...editor.state.doc.nodeAt(2)!.attrs, wordFill: null, wordBorderTop: null, wordPaddingLeft: null, wordVAlign: null }))
    const cleared = editor.view.nodeDOM(2) as HTMLElement
    assert.equal(cleared.style.backgroundColor, '')
    assert.equal(cleared.style.paddingLeft, '')
    assert.equal(cleared.getAttribute('data-word-format'), null)
    assert.equal(cleared.style.getPropertyPriority('border-top'), '')
  } finally { editor.destroy() }
})

test('Rowspan regrouping preserves table styles and intentional edits are not resurrected', () => {
  const editor = create({ type: 'doc', content: [{ type: 'table', attrs: { wordWidth: 75, wordAlign: 'center', wordIndent: 12, columnSize: '30,70' }, content: [
    { type: 'tableRow', content: [{ type: 'tableCell', attrs: { wordFill: '#ABCDEF' }, content: [paragraph('A')] }, { type: 'tableCell', content: [paragraph('B')] }] },
    { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('C')] }, { type: 'tableCell', content: [paragraph('D')] }] },
  ] }] })
  try {
    const { schema } = editor
    const previous = editor.state.doc.firstChild!
    const firstRow = previous.firstChild!, secondRow = previous.lastChild!
    const spanCell = firstRow.firstChild!.type.create({ ...firstRow.firstChild!.attrs, rowspan: 2 }, firstRow.firstChild!.content)
    const row1 = schema.nodes.tableRow.create(null, [spanCell, firstRow.lastChild!])
    const row2 = schema.nodes.tableRow.create(null, [secondRow.lastChild!])
    const merged = schema.nodes.table.create(previous.attrs, [row1, row2])
    editor.view.dispatch(editor.state.tr.replaceWith(0, previous.nodeSize, merged))
    const grouped = editor.state.doc.firstChild!
    assert.equal(grouped.firstChild!.type.name, 'tableRowGroup')
    assert.equal(grouped.attrs.wordWidth, 75); assert.equal(grouped.attrs.wordAlign, 'center')
    assert.equal(grouped.attrs.columnSize, '30,70')
    assert.equal(grouped.firstChild!.firstChild!.firstChild!.attrs.wordFill, '#ABCDEF')
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...grouped.attrs, wordWidth: 50, wordAlign: 'left', wordIndent: null }))
    assert.equal(editor.state.doc.firstChild!.attrs.wordWidth, 50)
    assert.equal(editor.state.doc.firstChild!.attrs.wordIndent, null)
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.firstChild!.attrs, wordWidth: null, wordAlign: null }))
    assert.equal(editor.state.doc.firstChild!.attrs.wordWidth, null)
    assert.equal(editor.state.doc.firstChild!.attrs.wordAlign, null)
    const wrapper = editor.view.nodeDOM(0) as HTMLElement
    assert.equal(wrapper.style.width, ''); assert.equal(wrapper.style.marginLeft, '')
  } finally { editor.destroy() }
})
test('Composite Word table with PaginationPlus settles without a DOM observer rebuild loop', async () => {
  const imported = await importDocument('advanced.docx', await createWordFixture())
  assert.equal(typeof imported.content, 'object')
  const original = browser.Element.prototype.setAttribute
  let writes = 0
  // Bound the old failure mode so a mutation-microtask loop produces an
  // assertion failure rather than starving the test runner's timeout forever.
  browser.Element.prototype.setAttribute = function(name: string, value: string) {
    if (this.closest('.tiptap') && ++writes > 500) return
    return original.call(this, name, value)
  }
  let editor: Editor | undefined
  try {
    const element = document.createElement('div'); document.body.appendChild(element)
    editor = new Editor({ element, extensions: [
      StarterKit, TextStyleKit, TextAlign.configure({ types: ['heading', 'paragraph'] }), Highlight,
      Image.configure({ allowBase64: true }), TableKitPlus, ColumnSections, WordFormatting,
      paginationExtension(imported.layout!),
    ], content: imported.content })
    const expected = JSON.stringify(editor.getJSON())
    await new Promise(resolve => setTimeout(resolve, 60))
    const settled = writes
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.ok(writes < 100, `Unexpected DOM rebuilds: ${writes} writes`)
    assert.equal(writes, settled, 'Word styles must not retrigger the editor observer after settling')
    assert.equal(JSON.stringify(editor.getJSON()), expected)
    const cells = Array.from(editor.view.dom.querySelectorAll('td,th'))
    assert.ok(cells.some(cell => Number(cell.getAttribute('rowspan')) === 2))
    assert.ok(cells.some(cell => cell.getAttribute('data-word-format') === 'true'))
    const widths = cells.map(cell => parseFloat((cell as HTMLElement).style.width))
    assert.equal(widths.length, 6)
    const expectedWidths = [33.3333, 66.6667, 33.3333, 66.6667, 66.6667, 100]
    widths.forEach((width, index) => assert.ok(Math.abs(width - expectedWidths[index]) < .001, `Grouped cell ${index} width ${width}`))
  } finally {
    editor?.destroy()
    browser.Element.prototype.setAttribute = original
  }
})
test('Hanging-indent render tags preserve original values across HTML and native reopen', () => {
  const values = [-18, 12, 0, undefined]
  const editor = create(native({ type: 'doc', content: values.map((value, index) => ({
    ...paragraph(`Paragraph ${index}`), attrs: { wordFontSize: 11, ...(value === undefined ? {} : { wordIndentFirst: value }) },
  })) }))
  try {
    for (const format of ['initial', 'html', 'native'] as const) {
      if (format === 'html') editor.commands.setContent(editor.getHTML())
      if (format === 'native') editor.commands.setContent(native(editor.getJSON()))
      const paragraphs = Array.from(parsed(editor.getHTML()).querySelectorAll('p'))
      assert.deepEqual(paragraphs.map(node => node.getAttribute('data-word-hanging')), ['true', null, null, null], format)
      assert.deepEqual(editor.getJSON().content!.map(node => node.attrs!.wordIndentFirst ?? undefined), values, format)
      // The inline value remains available for unlisted paragraphs and exports;
      // the pagination workaround is scoped to list text by the stylesheet.
      assert.equal(paragraphs[0].style.textIndent, '-18pt', format)
    }
  } finally { editor.destroy() }
})

test('List conversion, text edits and DOCX export retain hanging indents while tag follows edits', async () => {
  const attributes = { wordFontSize: 11, wordIndentLeft: 36, wordIndentRight: 0, wordIndentFirst: -18 }
  const editor = create(native({ type: 'doc', content: [{ ...paragraph('Hanging body text'), attrs: attributes }] }))
  const firstParagraph = () => {
    let found: JSONContent | undefined
    const visit = (node: JSONContent) => {
      if (!found && node.type === 'paragraph') found = node
      else if (!found) node.content?.forEach(visit)
    }
    visit(editor.getJSON())
    assert.ok(found)
    return found
  }
  try {
    editor.commands.setTextSelection(1)
    assert.equal(editor.commands.toggleBulletList(), true)
    assert.equal(editor.state.doc.firstChild!.type.name, 'bulletList')
    editor.commands.insertContent('Edited ')
    assert.deepEqual(sanitizeWordAttributes('paragraph', firstParagraph().attrs), attributes)
    assert.equal(parsed(editor.getHTML()).querySelector('li > p')!.dataset.wordHanging, 'true')

    editor.commands.setContent(editor.getHTML())
    editor.commands.setContent(native(editor.getJSON()))
    assert.deepEqual(sanitizeWordAttributes('paragraph', firstParagraph().attrs), attributes)
    const bytes = await toDocx({ id: 'hanging-list', title: 'Hanging list', updatedAt: '2026-10-27T00:00:00.000Z', content: native(editor.getJSON()) })
    const archive = await JSZip.loadAsync(bytes)
    const xml = new DOMParser().parseFromString(await archive.file('word/document.xml')!.async('string'), 'application/xml')
    const indentation = Array.from(xml.getElementsByTagName('*')).find(element => element.localName === 'ind')!
    assert.ok(indentation, 'Export retains explicit paragraph indentation')
    assert.equal(indentation.getAttribute('w:left'), '720')
    assert.equal(indentation.getAttribute('w:hanging'), '360')
    const imported = await importDocument('hanging-list.docx', bytes)
    assert.equal(typeof imported.content, 'object')
    const roundTrip = imported.content as JSONContent
    assert.equal(roundTrip.content![0].type, 'bulletList')
    const importedParagraph = roundTrip.content![0].content![0].content![0]
    assert.equal(importedParagraph.attrs!.wordIndentLeft, 36)
    assert.equal(importedParagraph.attrs!.wordIndentFirst, -18)

    editor.commands.setTextSelection(3)
    for (const indent of [0, 12, -9]) {
      assert.equal(editor.commands.updateAttributes('paragraph', { wordIndentFirst: indent }), true)
      const tag = indent < 0 ? 'true' : null
      assert.equal(parsed(editor.getHTML()).querySelector('li > p')!.getAttribute('data-word-hanging'), tag)
      assert.equal(editor.view.dom.querySelector('li > p')!.getAttribute('data-word-hanging'), tag)
      assert.equal(firstParagraph().attrs!.wordIndentFirst, indent)
    }
    assert.equal(editor.commands.toggleBulletList(), true)
    assert.equal(editor.state.doc.firstChild!.type.name, 'paragraph')
    assert.equal(firstParagraph().attrs!.wordIndentFirst, -9)
    assert.equal(parsed(editor.getHTML()).querySelector('p')!.style.textIndent, '-9pt')
  } finally { editor.destroy() }
})