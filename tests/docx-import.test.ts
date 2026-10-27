import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { Window } from 'happy-dom'
import type { JSONContent } from '@tiptap/react'
import { importDocx } from '../src/lib/docx-import'

const browser = new Window()
Object.assign(globalThis, { DOMParser: browser.DOMParser })
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6k1cAAAAASUVORK5CYII='
const r = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t>${text}</w:t></w:r>`
const p = (text: string, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${r(text)}</w:p>`
async function fixture(body: string, entries: Record<string, string> = {}, images: Record<string, string> = {}) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file('word/document.xml', `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:a="${A}" xmlns:wp="${WP}"><w:body>${body}</w:body></w:document>`)
  for (const [name, value] of Object.entries(entries)) zip.file(name, value)
  for (const [name, value] of Object.entries(images)) zip.file(name, value, { base64: true })
  return zip.generateAsync({ type: 'uint8array' })
}
function descendants(node: JSONContent, type: string): JSONContent[] {
  return [...(node.type === type ? [node] : []), ...(node.content ?? []).flatMap(child => descendants(child, type))]
}
const text = (node: JSONContent): string => node.text ?? (node.content ?? []).map(text).join('')
const mark = (node: JSONContent, type: string) => node.marks?.find(candidate => candidate.type === type)

// The package XML is intentionally authored independently from JScript's exporter.
// These tests catch import loss even when export and import would share the same bug.
test('DOCX resolves document defaults, basedOn styles, character styles and direct run overrides', async () => {
  const styles = `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="100" w:line="240"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:color w:val="112233"/></w:rPr><w:pPr><w:spacing w:after="120"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Body"><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Cambria"/><w:b/></w:rPr><w:pPr><w:ind w:left="720" w:firstLine="360"/><w:spacing w:before="80"/></w:pPr></w:style><w:style w:type="character" w:styleId="Accent"><w:rPr><w:i/><w:u w:val="single"/></w:rPr></w:style></w:styles>`
  const body = `<w:p><w:pPr><w:pStyle w:val="Body"/><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr>${r('Inherited')}${r('Direct', '<w:rStyle w:val="Accent"/><w:b w:val="0"/><w:sz w:val="32"/><w:color w:val="AA3344"/>')}</w:p>`
  const result = await importDocx(await fixture(body, { 'word/styles.xml': styles }))
  const para = descendants(result.content, 'paragraph')[0]
  assert.equal(para.attrs?.textAlign, 'center')
  assert.equal(para.attrs?.wordBefore, 4)
  assert.equal(para.attrs?.wordAfter, 0)
  assert.equal(para.attrs?.wordIndentLeft, 36)
  assert.equal(para.attrs?.wordIndentFirst, 18)
  assert.equal(para.attrs?.wordLine, 1)
  assert.equal(para.attrs?.wordFontFamily, 'Cambria')
  assert.equal(para.attrs?.wordFontSize, 11)
  const runs = descendants(para, 'text')
  assert.equal(mark(runs[0], 'textStyle')?.attrs?.fontFamily, 'Cambria')
  assert.equal(mark(runs[0], 'textStyle')?.attrs?.fontSize, '11pt')
  assert.equal(mark(runs[0], 'textStyle')?.attrs?.color?.toLowerCase(), '#112233')
  assert.ok(mark(runs[0], 'bold'))
  assert.equal(mark(runs[1], 'bold'), undefined)
  assert.ok(mark(runs[1], 'italic'))
  assert.ok(mark(runs[1], 'underline'))
  assert.equal(mark(runs[1], 'textStyle')?.attrs?.fontSize, '16pt')
  assert.equal(mark(runs[1], 'textStyle')?.attrs?.color?.toLowerCase(), '#aa3344')
})

test('DOCX imports oriented A5 paper and independent physical page margins', async () => {
  const result = await importDocx(await fixture(`${p('Landscape')}<w:sectPr><w:pgSz w:w="11906" w:h="8391" w:orient="landscape"/><w:pgMar w:top="567" w:right="850" w:bottom="1134" w:left="1417"/></w:sectPr>`))
  assert.equal(result.layout.pageSize, 'A5')
  assert.equal(result.layout.orientation, 'landscape')
  for (const [side, value] of Object.entries({ top: 10, right: 15, bottom: 20, left: 25 })) assert.ok(Math.abs(result.layout.margins[side as keyof typeof result.layout.margins] - value) < .03)
})

test('DOCX keeps blank paragraphs, explicit line breaks and paragraph text order', async () => {
  const result = await importDocx(await fixture(`<w:p/>${p('First')}<w:p>${r('Before')}<w:r><w:br/></w:r>${r('After')}</w:p><w:p/>`))
  const paragraphs = descendants(result.content, 'paragraph')
  assert.equal(paragraphs.length, 4)
  assert.equal(text(paragraphs[0]), '')
  assert.equal(text(paragraphs[1]), 'First')
  assert.equal(text(paragraphs[2]), 'BeforeAfter')
  assert.equal(descendants(paragraphs[2], 'hardBreak').length, 1)
  assert.equal(text(paragraphs[3]), '')
})

test('DOCX lists preserve start overrides, nested levels and separate numbering instances', async () => {
  const numbering = `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/></w:lvlOverride></w:num><w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="8"/></w:lvlOverride></w:num></w:numbering>`
  const num = (id: number, level = 0) => `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${id}"/></w:numPr>`
  const result = await importDocx(await fixture(p('Third', num(1)) + p('Detail', num(1, 1)) + p('Fourth', num(1)) + p('Separator') + p('Eighth', num(2)), { 'word/numbering.xml': numbering }))
  const lists = descendants(result.content, 'orderedList')
  assert.deepEqual(lists.map(list => list.attrs?.start), [3, 8])
  assert.equal(descendants(lists[0], 'bulletList').length, 1)
  assert.equal(text(result.content), 'ThirdDetailFourthSeparatorEighth')
})

test('DOCX table grid widths and horizontal/vertical cell merging survive import', async () => {
  const cell = (props: string, value: string) => `<w:tc><w:tcPr>${props}</w:tcPr>${p(value)}</w:tc>`
  const body = `<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${cell('<w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>', 'Merged')}${cell('', 'Top')}</w:tr><w:tr>${cell('<w:gridSpan w:val="2"/><w:vMerge/>', '')}${cell('', 'Bottom')}</w:tr></w:tbl>`
  const result = await importDocx(await fixture(body))
  const table = descendants(result.content, 'table')[0]
  assert.deepEqual(String(table.attrs?.columnSize).split(',').map(Number), [25, 25, 50])
  const rows = descendants(table, 'tableRow')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].content?.[0].attrs?.colspan, 2)
  assert.equal(rows[0].content?.[0].attrs?.rowspan, 2)
  assert.equal(rows[1].content?.length, 1)
  assert.equal(text(table), 'MergedTopBottom')
})

test('DOCX embedded image dimensions are retained while external image targets are not loaded', async () => {
  const drawing = (id: string, external = false) => `<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><a:graphic><a:graphicData><a:blip r:${external ? 'link' : 'embed'}="${id}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="${R}/image" Target="media/one.png"/><Relationship Id="external1" Type="${R}/image" TargetMode="External" Target="https://example.invalid/private.png"/></Relationships>`
  const result = await importDocx(await fixture(`<w:p>${drawing('image1')}${drawing('external1', true)}</w:p>`, { 'word/_rels/document.xml.rels': rels }, { 'word/media/one.png': PNG }))
  const images = descendants(result.content, 'image')
  assert.equal(images.length, 1)
  assert.ok(images[0].attrs?.src.startsWith('data:image/png;base64,'))
  assert.equal(images[0].attrs?.width, 96)
  assert.equal(images[0].attrs?.height, 48)
  assert.ok(result.warnings.some(warning => /estern|external/i.test(warning)))
})

test('DOCX reports unsupported running headers instead of claiming a lossless import', async () => {
  const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="header1" Type="${R}/header" Target="header1.xml"/></Relationships>`
  const result = await importDocx(await fixture(`${p('Body')}<w:sectPr><w:headerReference w:type="default" r:id="header1"/></w:sectPr>`, { 'word/_rels/document.xml.rels': rels, 'word/header1.xml': `<w:hdr xmlns:w="${W}">${p('Running header')}</w:hdr>` }))
  assert.equal(text(result.content), 'Body')
  assert.ok(result.warnings.some(warning => /intestazion|header/i.test(warning)))
})


test('DOCX interprets automatic line spacing in 240ths and exact spacing in twentieths of a point', async () => {
  const result = await importDocx(await fixture(p('Automatic', '<w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/><w:ind w:left="0" w:right="400" w:hanging="200"/>') + p('Exact', '<w:spacing w:line="360" w:lineRule="exact"/><w:keepNext/>')))
  const [automatic, exact] = descendants(result.content, 'paragraph')
  assert.equal(automatic.attrs?.wordLine, 1.15)
  assert.ok(automatic.attrs?.wordLinePt == null)
  assert.equal(automatic.attrs?.wordBefore, 0)
  assert.equal(automatic.attrs?.wordAfter, 0)
  assert.equal(automatic.attrs?.wordIndentLeft, 0)
  assert.equal(automatic.attrs?.wordIndentRight, 20)
  assert.equal(automatic.attrs?.wordIndentFirst, -10)
  assert.equal(exact.attrs?.wordLinePt, 18)
  assert.ok(exact.attrs?.wordLine == null)
  assert.equal(exact.attrs?.wordKeepNext, true)
})


test('DOCX rejects XML document type declarations instead of expanding entities', async () => {
  const zip = new JSZip()
  zip.file('word/document.xml', `<!DOCTYPE document [<!ENTITY secret SYSTEM "file:///private-data">]><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>&secret;</w:t></w:r></w:p></w:body></w:document>`)
  await assert.rejects(() => zip.generateAsync({ type: 'uint8array' }).then(importDocx))
})

test('DOCX theme fonts override fallback names and theme tints preserve Word luminance', async () => {
  const theme = `<a:theme xmlns:a="${A}" name="Test theme"><a:themeElements><a:clrScheme name="Test"><a:accent2><a:srgbClr val="4F81BD"/></a:accent2></a:clrScheme><a:fontScheme name="Test"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`
  const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="theme1" Type="${R}/theme" Target="theme/theme1.xml"/></Relationships>`
  const result = await importDocx(await fixture(`<w:p>${r('Theme formatting', '<w:rFonts w:ascii="Calibri" w:asciiTheme="minorHAnsi"/><w:color w:val="95B3D7" w:themeColor="accent2" w:themeTint="99"/>')}</w:p>`, { 'word/theme/theme1.xml': theme, 'word/_rels/document.xml.rels': rels }))
  const attrs = mark(descendants(result.content, 'text')[0], 'textStyle')?.attrs
  assert.equal(attrs?.fontFamily, 'Aptos')
  assert.match(String(attrs?.color), /^#[\da-f]{6}$/i)
  const actual = String(attrs?.color).slice(1)
  const expected = '95B3D7'
  for (const offset of [0, 2, 4]) assert.ok(Math.abs(parseInt(actual.slice(offset, offset + 2), 16) - parseInt(expected.slice(offset, offset + 2), 16)) <= 1, `Expected Word theme tint #${expected}, received #${actual}`)
})

test('DOCX retains table content controls and block-equation text instead of silently dropping them', async () => {
  const table = `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:sdt><w:sdtContent><w:tr><w:sdt><w:sdtContent><w:tc>${p('Controlled cell')}</w:tc></w:sdtContent></w:sdt></w:tr></w:sdtContent></w:sdt></w:tbl>`
  const math = '<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:oMath><m:r><m:t>Formula</m:t></m:r></m:oMath></m:oMathPara>'
  const result = await importDocx(await fixture(table + math))
  assert.equal(descendants(result.content, 'tableRow').length, 1)
  assert.equal(descendants(result.content, 'tableCell').length, 1)
  assert.equal(text(result.content), 'Controlled cellFormula')
  assert.ok(result.warnings.some(warning => /formul/i.test(warning)))
})
