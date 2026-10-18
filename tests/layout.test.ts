import assert from 'node:assert/strict'
import test from 'node:test'
import { inflateRawSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { DEFAULT_LAYOUT, normalizeLayout, pageDimensions } from '../src/lib/layout'
import { importDocument, toDocx, toNativeBytes, validateNativeDocument } from '../src/lib/documents'
import type { StoredDocument } from '../src/lib/types'

const doc: StoredDocument = {
  id: 'layout-test', title: 'Layout', updatedAt: '2026-10-18T14:00:00.000Z',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A paragraph to lay out.' }] }] },
}

// Inspect the produced OOXML directly, independently of the export configuration.
function zipEntry(bytes: Uint8Array, name: string): string {
  const data = Buffer.from(bytes)
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(end >= 0, 'Missing ZIP end directory')
  const count = data.readUInt16LE(end + 10)
  let position = data.readUInt32LE(end + 16)
  for (let i = 0; i < count; i++) {
    assert.equal(data.readUInt32LE(position), 0x02014b50)
    const length = data.readUInt16LE(position + 28)
    const fileName = data.subarray(position + 46, position + 46 + length).toString()
    if (fileName === name) {
      const local = data.readUInt32LE(position + 42)
      const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)
      const compressed = data.subarray(start, start + data.readUInt32LE(position + 20))
      return (data.readUInt16LE(position + 10) === 8 ? inflateRawSync(compressed) : compressed).toString()
    }
    position += 46 + length + data.readUInt16LE(position + 30) + data.readUInt16LE(position + 32)
  }
  throw new Error(`Missing ZIP entry ${name}`)
}

test('missing and invalid layout fields recover safe defaults without sharing mutable objects', () => {
  for (const input of [undefined, null, [], 'A4', {}, { pageSize: 'A0', orientation: 'diagonal', margins: [], lineSpacing: Infinity, paragraphBefore: '12', paragraphAfter: NaN }]) {
    assert.deepEqual(normalizeLayout(input), DEFAULT_LAYOUT)
  }
  const first = normalizeLayout(undefined)
  first.margins.left = 35
  assert.equal(normalizeLayout(undefined).margins.left, 20)
  assert.equal(DEFAULT_LAYOUT.margins.left, 20)
})

test('layout clamps finite values and rounds lengths to two decimals', () => {
  const layout = normalizeLayout({
    pageSize: 'A5', orientation: 'landscape',
    margins: { top: -9, right: 100, bottom: 17.126, left: '25' },
    lineSpacing: 3.5, paragraphBefore: -1, paragraphAfter: 60,
  })
  assert.deepEqual(layout, {
    pageSize: 'A5', orientation: 'landscape', margins: { top: 5, right: 50, bottom: 17.13, left: 20 },
    lineSpacing: 3, paragraphBefore: 0, paragraphAfter: 48,
  })
  assert.equal(normalizeLayout({ lineSpacing: 1.456 }).lineSpacing, 1.46)
  assert.equal(normalizeLayout({ paragraphAfter: 10.126 }).paragraphAfter, 10.13)
})

test('all supported paper formats have exact oriented millimetre dimensions', () => {
  for (const [pageSize, width, height] of [['A4', 210, 297], ['A5', 148, 210], ['Letter', 215.9, 279.4]] as const) {
    assert.deepEqual(pageDimensions(normalizeLayout({ pageSize })), { width, height })
    assert.deepEqual(pageDimensions(normalizeLayout({ pageSize, orientation: 'landscape' })), { width: height, height: width })
  }
  const smallest = normalizeLayout({ pageSize: 'A5', margins: { left: 100, right: 100 } })
  assert.equal(pageDimensions(smallest).width - smallest.margins.left - smallest.margins.right, 48)
})

test('renderer and desktop print normalization agree on valid, missing and hostile settings', () => {
  const desktop = createRequire(import.meta.url)('../electron/layout.cjs') as {
    normalizeLayout(value: unknown): ReturnType<typeof normalizeLayout>
    pageDimensions(value: unknown): { width: number; height: number }
  }
  for (const value of [
    undefined,
    { pageSize: 'Letter', orientation: 'landscape', margins: { top: 12.125, left: 5, right: 30, bottom: 50 }, paragraphAfter: 3.456, lineSpacing: 1.456 },
    { pageSize: 'A5', orientation: 'landscape', margins: { top: NaN, left: -100, right: 100, bottom: '10' }, paragraphBefore: Infinity, paragraphAfter: -1, lineSpacing: 9 },
  ]) {
    const normalized = normalizeLayout(value)
    assert.deepEqual(desktop.normalizeLayout(value), normalized)
    assert.deepEqual(desktop.pageDimensions(value), pageDimensions(normalized))
  }
})

test('native layout settings roundtrip, while old documents gain the default layout', async () => {
  const layout = normalizeLayout({ pageSize: 'Letter', orientation: 'landscape', margins: { left: 32, top: 14 }, lineSpacing: 1.25, paragraphBefore: 8, paragraphAfter: 16 })
  const bytes = toNativeBytes({ ...doc, layout })
  assert.deepEqual(validateNativeDocument(new TextDecoder().decode(bytes)).layout, layout)
  assert.deepEqual((await importDocument('layout.jscript', bytes)).layout, layout)
  const legacy = JSON.stringify({ format: 'jscript', version: 1, title: doc.title, content: doc.content })
  assert.deepEqual(validateNativeDocument(legacy).layout, DEFAULT_LAYOUT)
})

test('DOCX stores the chosen page geometry, asymmetric margins and paragraph spacing', async () => {
  const layout = normalizeLayout({ pageSize: 'A5', orientation: 'landscape', margins: { top: 12, right: 16, bottom: 18, left: 24 }, lineSpacing: 1.25, paragraphBefore: 6, paragraphAfter: 18 })
  const bytes = await toDocx({ ...doc, layout })
  const xml = zipEntry(bytes, 'word/document.xml')
  const size = xml.match(/<w:pgSz\b[^>]*\/>/)?.[0] ?? ''
  const margins = xml.match(/<w:pgMar\b[^>]*\/>/)?.[0] ?? ''
  const twips = (mm: number) => Math.round(mm * 1440 / 25.4)
  assert.match(size, new RegExp(`w:w="${twips(210)}"`))
  assert.match(size, new RegExp(`w:h="${twips(148)}"`))
  assert.match(size, /w:orient="landscape"/)
  for (const edge of ['top', 'right', 'bottom', 'left'] as const) assert.match(margins, new RegExp(`w:${edge}="${twips(layout.margins[edge])}"`))
  const paragraph = xml.match(/<w:p>.*?<\/w:p>/)?.[0] ?? ''
  assert.match(paragraph, /w:before="120"/)
  assert.match(paragraph, /w:after="360"/)
  assert.match(paragraph, /w:line="300"/)
  assert.match(paragraph, /w:lineRule="auto"/)
})

test('DOCX images fit inside the selected printable width and keep their aspect ratio', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Image')
  // Only browser bitmap decoding is substituted. Word image geometry is read from the actual ZIP.
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    naturalWidth = 1000
    naturalHeight = 500
    src = ''
    async decode() {}
  } })
  try {
    const layout = normalizeLayout({ pageSize: 'A5', margins: { left: 50, right: 50 } })
    const bytes = await toDocx({ ...doc, layout, content: { type: 'doc', content: [{ type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6k1cAAAAASUVORK5CYII=' } }] } })
    const xml = zipEntry(bytes, 'word/document.xml')
    const extent = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"/)
    assert.ok(extent, 'Missing Word drawing geometry')
    assert.ok(Math.abs(Number(extent[1]) - 48 * 36000) <= 1)
    assert.ok(Math.abs(Number(extent[1]) / Number(extent[2]) - 2) < 0.001)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'Image', previous)
    else Reflect.deleteProperty(globalThis, 'Image')
  }
})

test('DOCX headings keep their own spacing when paragraph layout changes', async () => {
  const content = {
    type: 'doc', content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Stable heading' }] },
      ...doc.content.content!,
    ],
  }
  const headingSpacing: string[] = []
  for (const settings of [
    { lineSpacing: 1, paragraphBefore: 3, paragraphAfter: 5 },
    { lineSpacing: 3, paragraphBefore: 24, paragraphAfter: 48 },
  ]) {
    const xml = zipEntry(await toDocx({ ...doc, content, layout: normalizeLayout(settings) }), 'word/document.xml')
    const heading = xml.match(/<w:p>.*?<\/w:p>/)?.[0] ?? ''
    assert.match(heading, /w:pStyle w:val="Heading1"/)
    const spacing = heading.match(/<w:spacing\b[^>]*\/>/)?.[0] ?? ''
    assert.match(spacing, /w:before="0"/)
    assert.match(spacing, /w:after="160"/)
    assert.match(spacing, /w:line="276"/)
    assert.match(spacing, /w:lineRule="auto"/)
    headingSpacing.push(spacing)
  }
  assert.equal(headingSpacing[0], headingSpacing[1])
})

test('DOCX retains every empty paragraph with body spacing and a 12pt paragraph mark', async () => {
  const content = { type: 'doc', content: [
    ...Array.from({ length: 80 }, () => ({ type: 'paragraph' })),
    { type: 'paragraph', content: [{ type: 'text', text: 'After eighty empty lines' }] },
  ] }
  const bytes = await toDocx({ ...doc, content })
  const xml = zipEntry(bytes, 'word/document.xml')
  const paragraphs = [...xml.matchAll(/<w:p>.*?<\/w:p>/g)].map(match => match[0])
  assert.equal(paragraphs.length, 81)
  for (const empty of paragraphs.slice(0, 80)) {
    assert.doesNotMatch(empty, /<w:t[\s>]/)
    assert.match(empty, /w:line="408"/)
    assert.match(empty, /w:after="216"/)
  }
  const styles = zipEntry(bytes, 'word/styles.xml')
  const defaultRun = styles.match(/<w:rPrDefault>.*?<\/w:rPrDefault>/)?.[0] ?? ''
  assert.match(defaultRun, /<w:sz w:val="24"\/>/)
  assert.match(defaultRun, /<w:szCs w:val="24"\/>/)
  assert.doesNotMatch(xml, /w:type="page"/)
  assert.deepEqual(content.content[0], { type: 'paragraph' })
})

test('print gives empty paragraphs a real line box without changing the document content', () => {
  // Requiring Electron from Node returns its executable path. documentHtml is pure and needs no window.
  const { documentHtml } = createRequire(import.meta.url)('../electron/print.cjs') as {
    documentHtml(value: { title: string; html: string }): string
  }
  const html = '<p></p>'.repeat(25) + '<p>After twenty-five empty lines</p>'
  const output = documentHtml({ title: 'Empty lines', html })
  assert.match(output, /p:empty::before\s*\{\s*content:\s*'\\00a0';\s*\}/)
  assert.match(output, /font: 12pt\/1\.7/)
  assert.equal((output.match(/<p><\/p>/g) ?? []).length, 25)
  assert.ok(output.includes(`<body>${html}</body>`))
})
