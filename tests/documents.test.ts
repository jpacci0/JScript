import assert from 'node:assert/strict'
import test from 'node:test'
import mammoth from 'mammoth'
import type { JSONContent } from '@tiptap/react'
import {
  importDocument, MAX_DOCUMENT_BYTES, safeFilename, toDocx,
  toNativeBytes, validateNativeDocument,
} from '../src/lib/documents'
import type { StoredDocument } from '../src/lib/types'
import { normalizeLayout } from '../src/lib/layout'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6k1cAAAAASUVORK5CYII='
const text = (value: string): JSONContent => ({ type: 'text', text: value })
const paragraph = (value: string): JSONContent => ({ type: 'paragraph', content: [text(value)] })
const native = (content: JSONContent, extra: Record<string, unknown> = {}) => JSON.stringify({ format: 'jscript', version: 1, title: 'Documento di prova', content, ...extra })

function fixture(): StoredDocument {
  return {
    id: 'test-document',
    title: 'Progetto – Città e creatività',
    updatedAt: '2026-10-18T14:00:00.000Z',
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [text('Idee per il progetto')] },
        {
          type: 'paragraph', attrs: { textAlign: 'justify' },
          content: [{ type: 'text', text: 'Scrivere con cura.', marks: [
            { type: 'bold' }, { type: 'italic' }, { type: 'underline' },
            { type: 'textStyle', attrs: { color: '#273147', fontFamily: 'Georgia', fontSize: '14pt' } },
            { type: 'highlight', attrs: { color: '#fff2a8' } },
          ] }],
        },
        {
          type: 'orderedList', attrs: { start: 3 },
          content: [
            { type: 'listItem', content: [paragraph('Prima attività')] },
            { type: 'listItem', content: [paragraph('Seconda attività'), {
              type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Un dettaglio')] }],
            }] },
          ],
        },
        {
          type: 'table', content: [
            { type: 'tableRow', content: [
              { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [paragraph('Attività')] },
              { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [paragraph('Stato')] },
            ] },
            { type: 'tableRow', content: [
              { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [paragraph('Bozza')] },
              { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [paragraph('Pronta')] },
            ] },
          ],
        },
        { type: 'image', attrs: { src: PNG, alt: 'Un pixel', width: 1, height: 1 } },
      ],
    },
  }
}

test('native format preserves Unicode text, image bytes, rich styles, nested lists and tables', () => {
  const doc = fixture()
  const bytes = toNativeBytes(doc)
  const decoded = new TextDecoder().decode(bytes)
  const metadata = JSON.parse(decoded)
  assert.equal(metadata.format, 'jscript')
  assert.equal(metadata.version, 1)
  assert.equal(metadata.updatedAt, doc.updatedAt)
  assert.deepEqual(validateNativeDocument(decoded), { title: doc.title, content: doc.content, layout: normalizeLayout(doc.layout) })
})

test('native importer rejects unsupported versions and malformed documents', () => {
  const content = { type: 'doc', content: [paragraph('Ciao')] }
  assert.throws(() => validateNativeDocument(native(content, { version: 2 })), /versione non supportata/)
  assert.throws(() => validateNativeDocument('{broken json'), /JSON valido/)
  assert.throws(() => validateNativeDocument(native({ type: 'paragraph' })), /Formato JScript non valido/)
  assert.throws(() => validateNativeDocument(native({ type: 'doc', content: [{ type: 'script' }] })), /elemento non supportato/)
})

test('native importer rejects remote and executable image sources', () => {
  for (const src of ['https://example.com/tracker.png', 'file:///C:/private.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=']) {
    assert.throws(() => validateNativeDocument(native({ type: 'doc', content: [{ type: 'image', attrs: { src } }] })), /immagine non supportata/)
  }
})

test('native importer strips unsafe links and arbitrary imported attributes', () => {
  const content: JSONContent = { type: 'doc', content: [{
    type: 'paragraph', attrs: { textAlign: 'left', onmouseover: 'alert(1)', style: 'background:url(https://example.com)' },
    content: [{ type: 'text', text: 'Leggi qui', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
  }] }
  const actual = validateNativeDocument(native(content)).content.content![0]
  assert.deepEqual(actual.attrs, { textAlign: 'left' })
  assert.deepEqual(actual.content![0].marks, [])
})

test('native importer rejects invalid nesting and deeply nested trees', () => {
  assert.throws(() => validateNativeDocument(native({ type: 'doc', content: [text('Text cannot be a root block')] })), /struttura del documento/)
  assert.throws(() => validateNativeDocument(native({ type: 'doc', content: [{ type: 'paragraph', content: [paragraph('Nested paragraph')] }] })), /struttura del documento/)
  assert.throws(() => validateNativeDocument(native({ type: 'doc', content: [{ type: 'orderedList', content: [] }] })), /struttura vuota/)
  let deep: JSONContent = paragraph('Nested')
  for (let i = 0; i < 45; i++) deep = { type: 'blockquote', content: [deep] }
  assert.throws(() => validateNativeDocument(native({ type: 'doc', content: [deep] })), /troppo complesso/)
})

test('safe filenames avoid Windows reserved names, invalid characters and trailing dots', () => {
  assert.equal(safeFilename('CON'), 'Documento-CON')
  assert.equal(safeFilename('com1.report'), 'Documento-com1.report')
  assert.equal(safeFilename('LPT9'), 'Documento-LPT9')
  assert.equal(safeFilename('Progetto: note / ottobre?'), 'Progetto- note - ottobre-')
  assert.equal(safeFilename('  Bozza...  '), 'Bozza')
  assert.equal(safeFilename('...'), 'Senza titolo')
  assert.equal(safeFilename('Città – report'), 'Città – report')
  assert.ok(safeFilename('a'.repeat(300)).length <= 150)
})

test('TXT import escapes HTML, preserves Unicode, newlines and blank paragraphs', async () => {
  const imported = await importDocument('Note ottobre.txt', new TextEncoder().encode('Città & creatività\r\n<script>alert("x")</script>\r\n\r\nFine'))
  assert.equal(imported.title, 'Note ottobre')
  assert.equal(imported.content, '<p>Città &amp; creatività</p><p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p><p></p><p>Fine</p>')
  assert.deepEqual(imported.warnings, [])
})

test('file importer accepts native documents and rejects legacy, corrupt and oversized inputs', async () => {
  const doc = fixture()
  assert.deepEqual(await importDocument('test.jscript', toNativeBytes(doc)), { title: doc.title, content: doc.content, layout: normalizeLayout(doc.layout), warnings: [] })
  await assert.rejects(importDocument('legacy.doc', new Uint8Array()), /vecchi file .doc non sono supportati/)
  await assert.rejects(importDocument('broken.docx', new TextEncoder().encode('Not a ZIP archive')), /DOCX non è valido/)
  await assert.rejects(importDocument('too-large.txt', new Uint8Array(MAX_DOCUMENT_BYTES + 1)), /limite di 25 MB/)
})

test('DOCX export is readable by an independent importer and preserves semantic structure', async () => {
  const doc = fixture()
  // Bitmap decoding is browser-only; native serialization above verifies image preservation.
  // This test exercises Word structures with Mammoth as an independent DOCX reader.
  doc.content.content = doc.content.content!.filter(node => node.type !== 'image')
  const bytes = await toDocx(doc)
  assert.equal(bytes[0], 0x50)
  assert.equal(bytes[1], 0x4b)
  const buffer = Buffer.from(bytes)
  const plain = await mammoth.extractRawText({ buffer })
  for (const expected of ['Idee per il progetto', 'Scrivere con cura.', 'Prima attività', 'Seconda attività', 'Un dettaglio', 'Attività', 'Stato', 'Bozza', 'Pronta']) {
    assert.ok(plain.value.includes(expected), `Missing exported text: ${expected}`)
  }
  const html = await mammoth.convertToHtml({ buffer })
  assert.match(html.value, /<h2>Idee per il progetto<\/h2>/)
  assert.match(html.value, /<strong>/)
  assert.match(html.value, /<em>/)
  assert.match(html.value, /<ol>/)
  assert.match(html.value, /<ul>/)
  assert.match(html.value, /<table>/)
  assert.equal(html.messages.filter(message => message.type === 'error').length, 0)
})

function groupedTable(): JSONContent {
  const cell = (value: string, rowspan = 1): JSONContent => ({
    type: 'tableCell', attrs: { colspan: 1, rowspan, colwidth: [120] }, content: [paragraph(value)],
  })
  return {
    type: 'table', attrs: { columnSize: '33.33333333333333,66.66666666666667' },
    content: [{ type: 'tableRowGroup', content: [
      { type: 'tableRow', content: [cell('Merged cell', 2), cell('First row')] },
      { type: 'tableRow', content: [cell('Second row')] },
    ] }],
  }
}

test('native roundtrip preserves grouped table rows, row spans and precise percentage widths', () => {
  const original: JSONContent = { type: 'doc', content: [groupedTable()] }
  const doc = { ...fixture(), content: original }
  const restored = validateNativeDocument(new TextDecoder().decode(toNativeBytes(doc)))
  assert.deepEqual(restored.content, original)
})

test('native tables reject invalid row groups and discard unsafe column widths', () => {
  for (const content of [[], [paragraph('Not a row')], [{ type: 'tableRowGroup', content: [] }]]) {
    assert.throws(() => validateNativeDocument(native({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRowGroup', content }] }] })))
  }
  for (const value of ['0,100', '50,101', '50,-1', 'NaN,50', '50,,50', '50px,50', 'url(evil)', '50,'.repeat(101), '1'.repeat(2001)]) {
    const table = groupedTable()
    table.attrs = { columnSize: value }
    const restored = validateNativeDocument(native({ type: 'doc', content: [table] }))
    assert.equal(restored.content.content![0].attrs?.columnSize, undefined)
  }
  const table = groupedTable()
  table.attrs = { columnSize: '' }
  assert.equal(validateNativeDocument(native({ type: 'doc', content: [table] })).content.content![0].attrs?.columnSize, '')
})

test('DOCX flattens paginated row groups into intact Word rows and merged cells', async () => {
  const bytes = await toDocx({ ...fixture(), content: { type: 'doc', content: [groupedTable()] } })
  const converted = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })
  assert.equal((converted.value.match(/<tr>/g) ?? []).length, 2)
  for (const expected of ['Merged cell', 'First row', 'Second row']) assert.ok(converted.value.includes(expected))
  assert.match(converted.value, /rowspan="2"/)
  assert.equal((converted.value.match(/Merged cell/g) ?? []).length, 1)
  assert.equal(converted.messages.filter(message => message.type === 'error').length, 0)
})
