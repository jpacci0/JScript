/** A representative DOCX fixture authored independently from JScript's exporter. */
import JSZip from 'jszip'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6k1cAAAAASUVORK5CYII='
const run = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`
const paragraph = (text: string, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${run(text)}</w:p>`
const border = '<w:top w:val="single" w:sz="8" w:color="7352D6"/><w:right w:val="single" w:sz="8" w:color="7352D6"/><w:bottom w:val="single" w:sz="8" w:color="7352D6"/><w:left w:val="single" w:sz="8" w:color="7352D6"/>'
const cell = (text: string, props = '', header = false) => `<w:tc><w:tcPr><w:tcBorders>${border}</w:tcBorders><w:tcMar><w:top w:w="100"/><w:left w:w="120"/><w:bottom w:w="100"/><w:right w:w="120"/></w:tcMar>${header ? '<w:shd w:fill="E9DFF8"/><w:vAlign w:val="center"/>' : ''}${props}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${run(text, header ? '<w:b/>' : '')}</w:p></w:tc>`

export async function createWordFixture(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>')
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="office" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="numbering" Type="${R}/numbering" Target="numbering.xml"/><Relationship Id="image1" Type="${R}/image" Target="media/one.png"/></Relationships>`)
  zip.file('word/styles.xml', `<w:styles xmlns:w="${W}">
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="243D62"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Titolo principale"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="0" w:after="160"/><w:keepNext/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia"/><w:sz w:val="48"/><w:color w:val="7352D6"/><w:b/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="BodyIndent"><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="60" w:after="160"/><w:ind w:left="240" w:firstLine="120"/><w:jc w:val="both"/></w:pPr></w:style>
    <w:style w:type="character" w:styleId="Accent"><w:rPr><w:i/><w:color w:val="BA3857"/></w:rPr></w:style>
  </w:styles>`)
  zip.file('word/numbering.xml', `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="480" w:hanging="240"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/></w:lvlOverride></w:num></w:numbering>`)
  const number = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
  const table = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:jc w:val="center"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="4800"/></w:tblGrid>
    <w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('Area', '', true)}${cell('Attività', '', true)}</w:tr>
    <w:tr>${cell('Sviluppo', '<w:vMerge w:val="restart"/><w:shd w:fill="F8F5FC"/>')}${cell('Componenti React e TypeScript')}</w:tr>
    <w:tr>${cell('', '<w:vMerge/>')}${cell('Verifiche automatiche')}</w:tr>
    <w:tr>${cell('Tabella con celle unite', '<w:gridSpan w:val="2"/><w:shd w:fill="E9DFF8"/>')}</w:tr>
  </w:tbl>`
  const body = paragraph('Documento Word avanzato', '<w:pStyle w:val="Title"/>')
    + `<w:p><w:pPr><w:pStyle w:val="BodyIndent"/></w:pPr>${run('Uno stile ereditato con rientro e spaziatura. ')}${run('Accento rosso corsivo.', '<w:rStyle w:val="Accent"/>')}</w:p>`
    + `<w:p><w:pPr><w:spacing w:before="0" w:after="80" w:line="360" w:lineRule="exact"/></w:pPr>${run('Interlinea esatta di 18 pt.', '<w:rFonts w:ascii="Georgia"/><w:sz w:val="26"/><w:b/><w:color w:val="243D62"/>')}</w:p>`
    + paragraph('La numerazione parte da tre.', number)
    + paragraph('La voce successiva mantiene la sequenza.', number)
    + table
    + paragraph('Immagine incorporata, 40 × 20 px:')
    + `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="381000" cy="190500"/><wp:docPr id="1" name="Pixel incorporato" descr="Piccola immagine di controllo"/><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="one.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="381000" cy="190500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    + `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="1020" w:bottom="850" w:left="1020"/></w:sectPr>`
  zip.file('word/document.xml', `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:a="${A}" xmlns:wp="${WP}" xmlns:pic="${PIC}"><w:body>${body}</w:body></w:document>`)
  zip.file('word/media/one.png', PNG, { base64: true })
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = path.resolve('test-results/docx-advanced-fixture.docx')
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(destination, await createWordFixture())
  console.log(destination)
}
