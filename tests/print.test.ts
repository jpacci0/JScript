import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const { isAllowedPrintRequest, documentHtml } = createRequire(import.meta.url)('../electron/print.cjs') as {
  isAllowedPrintRequest(requestURL: string, allowedFile: string): boolean
  documentHtml(value: { title: string; html: string }): string
}

test('print requests accept Chromium tilde normalization without allowing other files or network access', () => {
  const filename = path.resolve('RUNNER~1', 'print document', 'document.html')
  const allowed = pathToFileURL(filename).href
  assert.equal(isAllowedPrintRequest(allowed, allowed), true)
  assert.equal(isAllowedPrintRequest(allowed.replace(/%7E/gi, '~'), allowed), true)
  assert.equal(isAllowedPrintRequest('data:image/png;base64,AA==', allowed), true)
  for (const request of [
    pathToFileURL(path.resolve('RUNNER~1', 'print document', 'other.html')).href,
    allowed + '?other', allowed + '#other', allowed.replace('document.html', '%2Fdocument.html'),
    'https://example.com/document.html', 'file://example.com/document.html',
    'data:text/html,test', 'javascript:alert(1)', 'not a URL',
  ]) {
    assert.equal(isAllowedPrintRequest(request, allowed), false, request)
  }
})


const printBody = (html: string) => documentHtml({ title: 'Compatibilità Word', html }).split('<body>')[1].split('</body>')[0]

test('print preserves imported paragraph typography, exact spacing and hanging indents', () => {
  const body = printBody('<h2 data-word-format="true" style="font-family:Georgia;font-size:15pt;font-weight:400;letter-spacing:normal;color:inherit;margin-top:7.5pt;margin-bottom:12pt;margin-left:36pt;margin-right:10pt;text-indent:-18pt;line-height:20pt;break-after:avoid">Titolo <strong>enfasi</strong></h2><p data-word-format="true" style="line-height:1.15;margin-top:0pt;margin-bottom:3pt"></p>')
  for (const declaration of ['font-family:Georgia', 'font-size:15pt', 'font-weight:400', 'letter-spacing:normal', 'color:inherit', 'margin-top:7.5pt', 'margin-bottom:12pt', 'margin-left:36pt', 'margin-right:10pt', 'text-indent:-18pt', 'line-height:20pt', 'break-after:avoid', 'line-height:1.15']) assert.ok(body.includes(declaration), declaration)
  assert.match(body, /<h2 data-word-format="true"/)
  assert.match(body, /<p data-word-format="true"[^>]*><\/p>/)
})

test('print retains imported cell fills, padding, vertical alignment and important borders', () => {
  const body = printBody('<table data-word-format="true" style="width:75%;margin-left:auto;margin-right:0"><tr><td rowspan="2" colspan="2" data-word-format="true" style="background-color:#ABCDEF;vertical-align:middle;border-top:1.5pt double #112233 !important;border-right:0pt none #000000;border-bottom:2pt dashed #334455;border-left:0.75pt dotted #667788;padding-top:3pt;padding-right:6pt;padding-bottom:4pt;padding-left:5pt"><p>Cellula</p></td></tr></table>')
  for (const declaration of ['width:75%', 'margin-left:auto', 'margin-right:0', 'background-color:#ABCDEF', 'vertical-align:middle', 'border-top:1.5pt double #112233 !important', 'border-right:0pt none #000000', 'border-bottom:2pt dashed #334455', 'border-left:0.75pt dotted #667788', 'padding-top:3pt', 'padding-right:6pt', 'padding-bottom:4pt', 'padding-left:5pt']) assert.ok(body.includes(declaration), declaration)
  assert.ok(body.includes('rowspan="2"'))
  assert.ok(body.includes('colspan="2"'))
})

test('ordinary imported tables get a real column grid for unequal widths and merged cells', () => {
  const body = printBody('<table data-column-size="20,30,50" style="width:80%"><colgroup><col style="width:100%" /></colgroup><tbody><tr><td colspan="2">Primo gruppo</td><td rowspan="2">Secondo gruppo</td></tr><tr><td>A</td><td>B</td></tr></tbody></table>')
  assert.equal((body.match(/<colgroup>/g) || []).length, 1)
  assert.equal((body.match(/<col /g) || []).length, 3)
  assert.match(body, /<colgroup><col style="width:20%" \/><col style="width:30%" \/><col style="width:50%" \/><\/colgroup>/)
  assert.ok(body.includes('colspan="2"'))
  assert.ok(body.includes('rowspan="2"'))
  assert.ok(body.includes('width:80%'))
  assert.equal(body.includes('data-column-size'), false)
  assert.equal(body.includes('data-jscript-print-columns'), false)
})

test('nested ordinary tables preserve their own column grids and normalize independent weights', () => {
  const body = printBody('<table data-column-size="1,3"><tr><td><table data-column-size="10,10,20"><tr><td>A</td><td>B</td><td>C</td></tr></table></td><td>D</td></tr></table>')
  assert.equal((body.match(/<colgroup>/g) || []).length, 2)
  assert.equal((body.match(/<col /g) || []).length, 5)
  assert.ok(body.includes('width:75%'))
  assert.ok(body.includes('width:50%'))
})

test('invalid table grids and forged internal column metadata are discarded', () => {
  for (const data of ['0,100', '-1,101', '20%,80%', 'NaN,100', '1,url(https://example.com)', Array(101).fill('1').join(',')]) {
    const body = printBody(`<table data-column-size="${data}" data-jscript-print-columns="10,90"><tr><td>A</td><td>B</td></tr></table>`)
    assert.equal(body.includes('<colgroup>'), false, data)
    assert.equal(body.includes('data-jscript-print-columns'), false, data)
  }
})

test('advanced print formatting still rejects executable CSS, external media and arbitrary metadata', () => {
  const body = printBody('<h1 data-word-format="url(https://example.com)" onclick="alert(1)" style="font-family:url(https://example.com);font-size:expression(alert(1));margin-top:999999pt;margin-bottom:calc(1px + 2px);text-indent:-100000pt;position:fixed;line-height:30000pt;color:red">Titolo</h1><table data-column-size="25,75"><tr><td style="border-top:1pt solid url(https://example.com);padding-left:10000pt;background-image:url(https://example.com);background-color:#123456">Cella<img src="https://example.com/track.png" /></td></tr></table><script>alert(1)</script>')
  for (const value of ['url(', 'expression(', 'calc(', 'onclick', 'position:', '999999pt', '-100000pt', '30000pt', '10000pt', 'https://', '<script', 'data-word-format']) assert.equal(body.includes(value), false, value)
  assert.ok(body.includes('color:red'))
  assert.ok(body.includes('background-color:#123456'))
})

test('existing two-column sections retain their proportions and do not get an extra table grid', () => {
  const body = printBody('<table data-jscript-layout="columns" data-column-size="32,68"><tr><td>A</td><td>B</td></tr></table>')
  assert.ok(body.includes('--jscript-column-left:32%'))
  assert.ok(body.includes('--jscript-column-right:68%'))
  assert.equal(body.includes('<colgroup>'), false)
})


test('imported print header rows keep normal text, explicit bold and explicit cell fills', async () => {
  const { Window } = await import('happy-dom')
  const browser = new Window()
  try {
    browser.document.write(documentHtml({ title: 'Header rows', html: '<table><tr><th data-word-format="true">Normal <strong>Bold</strong></th><th data-word-format="true" style="background-color:#ABCDEF"><span style="color:#112233">Filled</span></th><th>Existing JScript header</th></tr></table>' }))
    const headers = browser.document.querySelectorAll('th')
    const imported = browser.getComputedStyle(headers[0])
    assert.equal(imported.fontWeight, '400')
    assert.equal(imported.backgroundColor, 'transparent')
    assert.equal(imported.color, browser.getComputedStyle(browser.document.body).color)
    assert.equal(browser.getComputedStyle(headers[0].querySelector('strong')!).fontWeight, '700')
    assert.match(browser.getComputedStyle(headers[1]).backgroundColor, /^(#abcdef|rgb\(171, 205, 239\))$/i)
    assert.match(browser.getComputedStyle(headers[1].querySelector('span')!).color, /^(#112233|rgb\(17, 34, 51\))$/i)
    assert.equal(browser.getComputedStyle(headers[2]).fontWeight, '600')
    assert.match(browser.getComputedStyle(headers[2]).backgroundColor, /^(#f4f1fa|rgb\(244, 241, 250\))$/i)
  } finally { await browser.happyDOM.abort() }
})


test('print honors both authored image dimensions instead of the intrinsic bitmap ratio', () => {
  const body = printBody('<img src="data:image/png;base64,AA==" width="40" height="20" alt="Stretched in Word" />')
  assert.ok(body.includes('width="40"'))
  assert.ok(body.includes('height="20"'))
  assert.match(body, /aspect-ratio:40 \/ 20/)
  assert.ok(body.includes('object-fit:fill'))
  const html = documentHtml({ title: 'Responsive image', html: body })
  assert.match(html, /img \{ max-width: 100%; height: auto; \}/)
})

test('print discards invalid image dimensions and unsafe ratio CSS', () => {
  for (const dimensions of ['width="0" height="20"', 'width="10001" height="20"', 'width="40" height="NaN"', 'width="40px" height="20"']) {
    const body = printBody(`<img src="data:image/png;base64,AA==" ${dimensions} style="aspect-ratio:expression(alert(1));object-fit:url(https://example.com)" />`)
    assert.equal(body.includes('aspect-ratio'), false, dimensions)
    assert.equal(body.includes('object-fit'), false, dimensions)
    assert.equal(body.includes('10001'), false, dimensions)
    assert.equal(body.includes('NaN'), false, dimensions)
  }
})

test('print retains browser-coalesced Word margins, cell padding and RGB border declarations', () => {
  const body = printBody('<p data-word-format="true" style="margin:0pt 0pt 6pt 24pt;text-indent:-12pt">La prima riga</p><table style="margin:0pt auto"><tr><td data-word-format="true" style="padding:5pt 6pt;border:1pt solid rgb(115, 82, 214) !important">Word borders</td><td style="border-width:1pt 2pt;border-style:solid dashed;border-color:rgb(115, 82, 214) #112233;border-top-color:rgb(0, 255, 128);border-right-width:2pt">Mixed borders</td></tr></table>')
  for (const declaration of ['margin:0pt 0pt 6pt 24pt', 'text-indent:-12pt', 'margin:0pt auto', 'padding:5pt 6pt', 'border:1pt solid rgb(115, 82, 214) !important', 'border-width:1pt 2pt', 'border-style:solid dashed', 'border-color:rgb(115, 82, 214) #112233', 'border-top-color:rgb(0, 255, 128)', 'border-right-width:2pt']) assert.ok(body.includes(declaration), declaration)
})

test('coalesced print styles remain bounded and reject external or executable values', () => {
  for (const declaration of ['margin:0pt 0pt 6pt 24pt 1pt', 'margin:0pt -99999pt', 'margin:expression(alert(1))', 'padding:1pt -1pt', 'padding:101pt', 'border:1pt solid rgb(256, 0, 0)', 'border:13pt solid #112233', 'border-color:url(https://example.com)', 'border-top-color:var(--external)', 'border-style:solid hidden', 'border-width:1pt 2pt 3pt 4pt 5pt']) {
    const body = printBody(`<p style="${declaration}">Text</p>`)
    assert.equal(body.includes('style='), false, declaration)
  }
})

test('Word list markers get printable space while first and continuation lines align', () => {
  const body = printBody('<ol start="3"><li><p data-word-format="true" style="margin:0pt 0pt 6pt 24pt;text-indent:-12pt;font-size:11pt;font-family:Calibri">La prima riga</p><ul><li><p data-word-format="true" style="margin-left:36pt;text-indent:-18pt">Nested</p></li></ul></li><li><p data-word-format="true">No explicit indent</p></li></ol><ol><li><p>Existing list</p></li></ol>')
  assert.match(body, /<ol start="3"><li style="margin-left:12pt;font-size:11pt;font-family:Calibri">/)
  assert.ok(body.includes('margin-left:12pt !important;text-indent:0pt !important'))
  assert.ok(body.includes('margin-left:24pt !important;text-indent:0pt !important'))
  assert.ok(body.includes('<li style="margin-left:12pt"><p data-word-format="true" style="margin-left:0pt !important;text-indent:0pt !important">No explicit indent'))
  assert.ok(body.includes('<ol><li><p>Existing list</p></li></ol>'))
})


test('print corrects only the first imported list paragraph and preserves other intentional indents', async () => {
  const { Window } = await import('happy-dom')
  const browser = new Window()
  try {
    const html = '<p data-word-format="true" style="margin-left:24pt;text-indent:-12pt">Independent hanging paragraph</p><ol start="3"><li><p data-word-format="true" data-word-hanging="true" style="margin:0pt 0pt 6pt 24pt;text-indent:-12pt">First list paragraph</p><p data-word-format="true" data-word-hanging="true" style="margin-left:24pt;text-indent:-12pt">Later hanging paragraph</p></li><li><p data-word-format="true" style="margin-left:24pt;text-indent:6pt">Positive first-line indent</p></li></ol><ul><li><p style="margin-left:24pt;text-indent:-12pt">Unmarked paragraph</p></li></ul>'
    browser.document.write(documentHtml({ title: 'List semantics', html }))
    const paragraphs = [...browser.document.querySelectorAll('p')]
    const styles = paragraphs.map(paragraph => browser.getComputedStyle(paragraph))
    assert.equal(paragraphs[0].style.textIndent, '-12pt', 'a standalone hanging indent is preserved')
    assert.equal(parseFloat(styles[1].textIndent), 0, 'the list body starts at its continuation-line position')
    const listInset = parseFloat(styles[1].marginLeft) + parseFloat(browser.getComputedStyle(paragraphs[1].parentElement!).marginLeft)
    assert.ok(Math.abs(listInset - parseFloat(styles[0].marginLeft)) < 0.001, 'marker space retains the Word text inset')
    assert.equal(styles[2].textIndent, styles[0].textIndent, 'later paragraphs retain their independent hanging indent')
    assert.equal(paragraphs[3].style.textIndent, '6pt', 'positive first-line indent is preserved')
    assert.equal(styles[4].textIndent, styles[0].textIndent, 'ordinary lists are unchanged')
    assert.equal(browser.document.querySelector('ol')!.start, 3)
  } finally { await browser.happyDOM.abort() }
})
