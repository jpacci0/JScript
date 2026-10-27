import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { inflateRawSync } from 'node:zlib'
import mammoth from 'mammoth'
import type { JSONContent } from '@tiptap/react'
import { importDocument, toDocx, toNativeBytes, validateNativeDocument } from '../src/lib/documents'
import type { StoredDocument } from '../src/lib/types'

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const cell = (text: string): JSONContent => ({ type: 'tableCell', content: [paragraph(text)] })
const row = (left: string, right: string): JSONContent => ({ type: 'tableRow', content: [cell(left), cell(right)] })
function document(columnSize = '33.333,66.667'): StoredDocument {
  return { id: 'cv-columns', title: 'CV a due colonne', updatedAt: '2026-10-18T15:00:00.000Z', content: {
    type: 'doc', content: [{ type: 'table', attrs: { layout: 'columns', columnSize }, content: [row('Contatti', 'Profilo professionale'), row('Competenze', 'Esperienze lavorative')] }],
  } }
}
const native = (doc: StoredDocument) => new TextDecoder().decode(toNativeBytes(doc))

function zipEntry(bytes: Uint8Array, name: string): string {
  const data = Buffer.from(bytes)
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(end >= 0)
  let position = data.readUInt32LE(end + 16)
  for (let i = 0; i < data.readUInt16LE(end + 10); i++) {
    const length = data.readUInt16LE(position + 28)
    if (data.subarray(position + 46, position + 46 + length).toString() === name) {
      const local = data.readUInt32LE(position + 42)
      const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)
      const compressed = data.subarray(start, start + data.readUInt32LE(position + 20))
      return (data.readUInt16LE(position + 10) === 8 ? inflateRawSync(compressed) : compressed).toString()
    }
    position += 46 + length + data.readUInt16LE(position + 30) + data.readUInt16LE(position + 32)
  }
  throw new Error(`Missing ZIP entry ${name}`)
}

test('native two-column documents preserve independent sections and column proportions', async () => {
  for (const proportions of ['50,50', '33.333,66.667']) {
    const doc = document(proportions)
    assert.deepEqual(validateNativeDocument(native(doc)).content, doc.content)
    assert.deepEqual((await importDocument('cv.jscript', toNativeBytes(doc))).content, doc.content)
  }
  const grouped = document()
  const table = grouped.content.content![0]
  table.content = [{ type: 'tableRowGroup', content: table.content }]
  assert.deepEqual(validateNativeDocument(native(grouped)).content, grouped.content)
})

test('two-column validation allows only the layout token and prevents merged or missing columns', () => {
  for (const invalid of ['grid', '<script>', 'columns; display:none']) {
    const doc = document()
    doc.content.content![0].attrs!.layout = invalid
    assert.equal(validateNativeDocument(native(doc)).content.content![0].attrs?.layout, undefined)
  }
  const oneColumn = document()
  oneColumn.content.content![0].content![0].content!.pop()
  assert.throws(() => validateNativeDocument(native(oneColumn)), /due celle indipendenti/)
  const merged = document()
  merged.content.content![0].content![0].content![0].attrs = { rowspan: 2 }
  assert.throws(() => validateNativeDocument(native(merged)), /senza celle unite/)
  for (const invalid of ['', '100', '33,33,34', 'bad,50', '0,100']) {
    assert.equal(validateNativeDocument(native(document(invalid))).content.content![0].attrs?.columnSize, '50,50')
  }
})

test('DOCX exports borderless fixed-width columns with an 8mm gutter and flowing rows', async () => {
  const bytes = await toDocx(document())
  const xml = zipEntry(bytes, 'word/document.xml')
  assert.equal((xml.match(/<w:tr>/g) ?? []).length, 2)
  assert.equal((xml.match(/<w:tc>/g) ?? []).length, 4)
  assert.match(xml, /<w:tblLayout w:type="fixed"\/>/)
  const grid = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map(match => Number(match[1]))
  assert.equal(grid.length, 2)
  assert.ok(Math.abs(grid[1] / grid[0] - 2) < 0.002)
  assert.ok(Math.abs(grid[0] + grid[1] - 170 * 1440 / 25.4) < 2)
  const borders = [...xml.matchAll(/<w:(?:tblBorders|tcBorders)>.*?<\/w:(?:tblBorders|tcBorders)>/g)].map(match => match[0])
  assert.equal(borders.length, 5)
  for (const border of borders) {
    assert.match(border, /w:val="none"/)
    assert.doesNotMatch(border, /w:val="single"/)
  }
  const cells = [...xml.matchAll(/<w:tc>.*?<\/w:tc>/g)].map(match => match[0])
  assert.match(cells[0], /<w:right w:type="dxa" w:w="227"\/>/)
  assert.match(cells[1], /<w:left w:type="dxa" w:w="227"\/>/)
  for (const column of cells) {
    assert.match(column, /<w:top w:type="dxa" w:w="0"\/>/)
    assert.doesNotMatch(column, /<w:shd/)
  }
  assert.doesNotMatch(xml, /<w:cantSplit(?:\s+w:val="(?:true|1)")?\/>/)
  const converted = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  for (const text of ['Contatti', 'Profilo professionale', 'Competenze', 'Esperienze lavorative']) assert.ok(converted.value.includes(text))
})

test('DOCX ordinary tables preserve their explicit column widths, borders and header background', async () => {
  const doc = document()
  delete doc.content.content![0].attrs!.layout
  doc.content.content![0].content![0].content![0].type = 'tableHeader'
  const xml = zipEntry(await toDocx(doc), 'word/document.xml')
  assert.match(xml, /w:val="single"/)
  assert.match(xml, /w:fill="F0F2F5"/)
  assert.match(xml, /<w:tblLayout w:type="fixed"\/>/)
  const widths = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map(match => Number(match[1]))
  assert.ok(Math.abs(widths[1] / widths[0] - 2) < .01)
})

test('DOCX column images fit their own content width including the gutter', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Image')
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    naturalWidth = 1000
    naturalHeight = 500
    src = ''
    async decode() {}
  } })
  try {
    const doc = document('50,50')
    const image: JSONContent = { type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6k1cAAAAASUVORK5CYII=' } }
    doc.content.content![0].content![0].content![0].content = [image]
    const xml = zipEntry(await toDocx(doc), 'word/document.xml')
    const width = Number(xml.match(/<wp:extent cx="(\d+)"/)?.[1])
    assert.ok(Number.isFinite(width))
    assert.ok(Math.abs(width / 36000 - 81) < 0.02, `Image width should be 85mm cell minus 4mm gutter, got ${width / 36000}mm`)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'Image', previous)
    else Reflect.deleteProperty(globalThis, 'Image')
  }
})

test('print preserves only the supported columns marker and safe percentage column widths', () => {
  const { documentHtml } = createRequire(import.meta.url)('../electron/print.cjs') as { documentHtml(value: { title: string; html: string }): string }
  const output = documentHtml({ title: 'CV', html: '<table data-jscript-layout="columns" onclick="alert(1)"><colgroup><col style="width:33.333%"><col style="width:66.667%"></colgroup><tbody><tr><th>Contatti</th><td>Profilo</td></tr></tbody></table><table data-jscript-layout="anything"><tr><td>Other</td></tr></table><div data-jscript-layout="columns">No marker</div>' })
  const body = output.split('<body>')[1]
  assert.equal((body.match(/data-jscript-layout="columns"/g) ?? []).length, 1)
  assert.doesNotMatch(body, /onclick|data-jscript-layout="anything"/)
  assert.match(body, /width:33\.333%/)
  assert.match(body, /width:66\.667%/)
  assert.match(output, /padding-right: 4mm/)
  assert.match(output, /padding-left: 4mm/)
  assert.match(output, /tr \{ break-inside: auto; \}/)
  assert.match(output, /border: 0; padding: 0; background: transparent/)
})

test('print recovers the sidebar ratio from actual TablePlus HTML without a colgroup', () => {
  const { documentHtml } = createRequire(import.meta.url)('../electron/print.cjs') as { documentHtml(value: { title: string; html: string }): string }
  // This is TablePlus.renderHTML's format: widths exist solely on data-column-size.
  const serialized = '<table data-jscript-layout="columns" data-column-size="33.333,66.667" border="1"><tr><td colspan="1" rowspan="1"><p>Contatti</p></td><td colspan="1" rowspan="1"><p>PROFILO</p></td></tr></table>'
  const output = documentHtml({ title: 'CV', html: serialized })
  const body = output.split('<body>')[1]
  assert.match(body, /--jscript-column-left:33\.333%/)
  assert.match(body, /--jscript-column-right:66\.667%/)
  assert.doesNotMatch(body, /data-column-size|border="1"|<colgroup/)
  assert.match(output, /:first-child \{ width: var\(--jscript-column-left, 50%\);/)
  assert.match(output, /:last-child \{ width: var\(--jscript-column-right, 50%\);/)
})

test('print normalizes numeric width metadata and gives malformed columns a safe equal fallback', () => {
  const { documentHtml } = createRequire(import.meta.url)('../electron/print.cjs') as { documentHtml(value: { title: string; html: string }): string }
  const bodyFor = (widths: string, marker = 'columns') => documentHtml({ title: 'CV', html: `<table data-jscript-layout="${marker}" data-column-size="${widths}"><tr><td>A</td><td>B</td></tr></table>` }).split('<body>')[1]
  assert.match(bodyFor('25,50'), /--jscript-column-left:33\.333333%;--jscript-column-right:66\.666667%/)
  for (const invalid of ['', '100', '0,100', '-1,100', '33,33,34', 'NaN,50', '101,50', '33%;background:url(evil),67']) {
    const body = bodyFor(invalid)
    assert.match(body, /--jscript-column-left:50%;--jscript-column-right:50%/)
    assert.doesNotMatch(body, /url\(|data-column-size/)
  }
  assert.doesNotMatch(bodyFor('33,67', 'normal'), /--jscript-column|data-jscript-layout/)
})
