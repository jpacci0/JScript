import type { JSONContent } from '@tiptap/react'
import DOMPurify from 'dompurify'
import { importDocx } from './docx-import'
import { sanitizeWordAttributes } from './word-format'
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, LevelFormat,
  Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, PageOrientation, LineRuleType, TableLayoutType, ExternalHyperlink, VerticalAlign,
  type IParagraphOptions, type IRunOptions, type INumberingOptions, type IBorderOptions,
} from 'docx'
import type { DocumentLayout, StoredDocument } from './types'
import { normalizeLayout, pageDimensions } from './layout'

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
const IMAGE_DATA = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$/i
const BLOCKS = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'image'])
const NODES = new Set(['doc', ...BLOCKS, 'text', 'hardBreak', 'listItem', 'tableRowGroup', 'tableRow', 'tableCell', 'tableHeader'])
const MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'textStyle', 'highlight', 'link', 'superscript', 'subscript'])

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function safeLink(value: unknown): value is string {
  return typeof value === 'string' && value.length < 2048 && /^(https?:\/\/|mailto:|tel:)/i.test(value.trim())
}

function safeColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{1,20}|rgba?\([\d\s.,%]+\))$/i.test(value) ? value : undefined
}

function boundedNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined
}

// TablePlus stores column percentages (not its pixel-based minimum resize width).
function columnPercentages(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2000) return undefined
  if (!value.trim()) return ''
  const columns = value.split(',').map(column => column.trim())
  if (columns.length > 100 || !columns.every(column => /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(column) && Number(column) > 0 && Number(column) <= 100)) return undefined
  return columns.join(',')
}

function attrsFor(type: string, value: unknown): Record<string, unknown> | undefined {
  if (!plain(value)) return undefined
  const attrs: Record<string, unknown> = { ...sanitizeWordAttributes(type, value) }
  if (['paragraph', 'heading'].includes(type) && ['left', 'center', 'right', 'justify'].includes(String(value.textAlign))) attrs.textAlign = value.textAlign
  if (type === 'heading') attrs.level = boundedNumber(value.level, 1, 6) ?? 1
  if (type === 'orderedList') attrs.start = boundedNumber(value.start, 1, 100000) ?? 1
  if (type === 'codeBlock' && typeof value.language === 'string') attrs.language = value.language.slice(0, 40)
  if (type === 'textStyle') {
    if (safeColor(value.color)) attrs.color = value.color
    if (typeof value.fontFamily === 'string' && /^[a-z0-9 ,\-'\"]{1,100}$/i.test(value.fontFamily)) attrs.fontFamily = value.fontFamily
    if (typeof value.fontSize === 'string' && /^\d{1,3}(\.\d{1,2})?(px|pt)$/.test(value.fontSize)) attrs.fontSize = value.fontSize
  }
  if (type === 'highlight' && safeColor(value.color)) attrs.color = value.color
  if (type === 'link' && safeLink(value.href)) {
    attrs.href = value.href.trim()
    attrs.target = '_blank'
    attrs.rel = 'noopener noreferrer'
  }
  if (type === 'image') {
    if (typeof value.src !== 'string' || !IMAGE_DATA.test(value.src)) throw new Error('Il documento contiene un’immagine non supportata. Sono ammesse immagini PNG, JPEG o WebP incorporate.')
    attrs.src = value.src
    for (const key of ['alt', 'title']) if (typeof value[key] === 'string') attrs[key] = value[key].slice(0, 500)
    for (const key of ['width', 'height']) if (boundedNumber(value[key], 1, 10000)) attrs[key] = value[key]
  }
  if (type === 'table') {
    const columnSize = columnPercentages(value.columnSize)
    if (columnSize !== undefined) attrs.columnSize = columnSize
    if (value.layout === 'columns') {
      attrs.layout = 'columns'
      if (!columnSize || columnSize.split(',').length !== 2) attrs.columnSize = '50,50'
    }
  }
  if (type === 'tableCell' || type === 'tableHeader') {
    attrs.colspan = boundedNumber(value.colspan, 1, 100) ?? 1
    attrs.rowspan = boundedNumber(value.rowspan, 1, 100) ?? 1
    if (Array.isArray(value.colwidth) && value.colwidth.length <= 100 && value.colwidth.every(v => boundedNumber(v, 1, 10000))) attrs.colwidth = value.colwidth
  }
  return Object.keys(attrs).length ? attrs : undefined
}

/** Empty rows are valid only when earlier merged cells cover the entire row. */
function validateMergedRows(table: JSONContent): void {
  const rows = (table.content ?? []).flatMap(row => row.type === 'tableRowGroup' ? row.content ?? [] : [row])
  if (!rows.some(row => !row.content?.length)) return
  let width = 0
  const remaining: number[] = []
  for (let index = 0; index < rows.length; index++) {
    const covered = remaining.map(count => count > 0)
    let column = 0
    for (const cell of rows[index].content ?? []) {
      while (covered[column]) column++
      const span = Number(cell.attrs?.colspan) || 1
      if (column + span > 100 || (width && column + span > width)) throw new Error('Celle unite non valide nella tabella.')
      for (let offset = 0; offset < span; offset++) {
        if (covered[column + offset]) throw new Error('Celle sovrapposte nella tabella.')
        covered[column + offset] = true
        remaining[column + offset] = Number(cell.attrs?.rowspan) || 1
      }
      column += span
    }
    if (!index) width = covered.length
    if (!width || Array.from({ length: width }, (_, i) => covered[i]).some(value => !value)) throw new Error('La tabella contiene una riga vuota non coperta da celle unite.')
    for (let i = 0; i < remaining.length; i++) remaining[i] = Math.max(0, remaining[i] - 1)
  }
}

/** Rebuild a bounded allowlisted tree; never pass imported arbitrary attributes to the editor. */
export function validateNativeDocument(text: string): { title: string; content: JSONContent; layout: DocumentLayout; importWarnings?: string[] } {
  if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES) throw new Error('Il file supera il limite di 25 MB.')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('Il file JScript non contiene JSON valido.') }
  if (!plain(value) || value.format !== 'jscript' || value.version !== 1 || !plain(value.content) || value.content.type !== 'doc') throw new Error('Formato JScript non valido o versione non supportata.')
  let count = 0
  const read = (input: unknown, depth: number): JSONContent => {
    if (++count > 50000 || depth > 40) throw new Error('Il documento è troppo complesso per essere aperto.')
    if (!plain(input) || typeof input.type !== 'string' || !NODES.has(input.type)) throw new Error('Il documento contiene un elemento non supportato.')
    const type = input.type
    const node: JSONContent = { type }
    if (type === 'text') {
      if (typeof input.text !== 'string' || !input.text.length) throw new Error('Testo non valido nel documento.')
      node.text = input.text
    }
    if (type === 'image' && !plain(input.attrs)) throw new Error('Immagine priva di dati.')
    const attrs = attrsFor(type, input.attrs)
    if (attrs) node.attrs = attrs
    if (input.marks !== undefined) {
      if (!Array.isArray(input.marks) || input.marks.length > 15) throw new Error('Formattazione non valida.')
      node.marks = input.marks.flatMap(mark => {
        if (!plain(mark) || typeof mark.type !== 'string' || !MARKS.has(mark.type)) return []
        const safeAttrs = attrsFor(mark.type, mark.attrs)
        if (mark.type === 'link' && !safeAttrs?.href) return []
        return [{ type: mark.type, ...(safeAttrs ? { attrs: safeAttrs } : {}) }]
      })
    }
    if (input.content !== undefined) {
      if (!Array.isArray(input.content)) throw new Error('Struttura del documento non valida.')
      node.content = input.content.map(child => read(child, depth + 1))
      const validChildren = (child: JSONContent) => {
        if (type === 'doc' || type === 'blockquote' || type === 'tableCell' || type === 'tableHeader' || type === 'listItem') return BLOCKS.has(child.type ?? '')
        if (type === 'paragraph' || type === 'heading') return child.type === 'text' || child.type === 'hardBreak'
        if (type === 'codeBlock') return child.type === 'text'
        if (type === 'bulletList' || type === 'orderedList') return child.type === 'listItem'
        if (type === 'table') return child.type === 'tableRow' || child.type === 'tableRowGroup'
        if (type === 'tableRowGroup') return child.type === 'tableRow'
        if (type === 'tableRow') return child.type === 'tableCell' || child.type === 'tableHeader'
        return false
      }
      if (!node.content.every(validChildren)) throw new Error('La struttura del documento non è supportata.')
    }
    if (['bulletList', 'orderedList', 'table', 'tableRowGroup', 'listItem'].includes(type) && !node.content?.length) throw new Error('Il documento contiene una struttura vuota non valida.')
    if (type === 'listItem' && node.content?.[0]?.type !== 'paragraph') throw new Error('Un elenco contiene una voce non valida.')
    if (['tableCell', 'tableHeader', 'blockquote'].includes(type) && !node.content?.length) node.content = [{ type: 'paragraph' }]
    if (type === 'table') validateMergedRows(node)
    if (type === 'table' && node.attrs?.layout === 'columns') {
      const rows = (node.content ?? []).flatMap(child => child.type === 'tableRowGroup' ? child.content ?? [] : [child])
      if (!rows.every(row => row.content?.length === 2 && row.content.every(cell => (cell.attrs?.colspan ?? 1) === 1 && (cell.attrs?.rowspan ?? 1) === 1))) {
        throw new Error('Il layout a due colonne richiede due celle indipendenti per ogni riga, senza celle unite.')
      }
    }
    return node
  }
  const content = read(value.content, 0)
  if (!content.content?.length) content.content = [{ type: 'paragraph' }]
  return { title: typeof value.title === 'string' ? value.title.trim().slice(0, 200) || 'Senza titolo' : 'Senza titolo', content, layout: normalizeLayout(value.layout), ...(Array.isArray(value.importWarnings) && value.importWarnings.length ? { importWarnings: value.importWarnings.filter((warning: unknown): warning is string => typeof warning === 'string').slice(0, 30).map((warning: string) => warning.slice(0, 1000)) } : {}) }
}

export function sanitizeImportedHtml(html: string): string {
  if (html.length > MAX_UNCOMPRESSED_BYTES) throw new Error('Il contenuto importato è troppo grande.')
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sup', 'sub', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['style', 'script', 'iframe', 'svg', 'math'],
    FORBID_ATTR: ['style', 'srcset'],
  })
  const template = document.createElement('template')
  template.innerHTML = clean
  template.content.querySelectorAll('img').forEach(img => {
    if (!IMAGE_DATA.test(img.getAttribute('src') ?? '')) img.remove()
  })
  template.content.querySelectorAll('a').forEach(link => {
    if (!safeLink(link.getAttribute('href'))) link.removeAttribute('href')
    else { link.setAttribute('rel', 'noopener noreferrer'); link.setAttribute('target', '_blank') }
  })
  return template.innerHTML
}

// Inspect ZIP directory metadata before Mammoth decompresses an untrusted DOCX.
function checkDocxArchive(data: Uint8Array): void {
  if (data.length < 22) throw new Error('Il file DOCX non è valido.')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let end = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === data.length) { end = i; break }
  }
  if (end < 0) throw new Error('Archivio DOCX non valido.')
  const entries = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  if (entries > 2000 || offset === 0xffffffff || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) throw new Error('Archivio DOCX troppo complesso o non supportato.')
  let total = 0
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Archivio DOCX danneggiato.')
    total += view.getUint32(offset + 24, true)
    if (total > MAX_UNCOMPRESSED_BYTES) throw new Error('Il DOCX contiene troppi dati decompressi (massimo 100 MB).')
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
  }
}

export async function importDocument(name: string, data: Uint8Array): Promise<{ title: string; content: string | JSONContent; layout?: DocumentLayout; importWarnings?: string[]; warnings: string[] }> {
  if (data.byteLength > MAX_DOCUMENT_BYTES) throw new Error('Il file supera il limite di 25 MB.')
  const ext = name.split('.').pop()?.toLowerCase()
  const title = name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Senza titolo'
  if (ext === 'jscript') return { ...validateNativeDocument(new TextDecoder().decode(data)), warnings: [] }
  if (ext === 'html' || ext === 'htm') return { title, content: sanitizeImportedHtml(new TextDecoder().decode(data)), warnings: ['HTML importato: gli stili avanzati e le immagini esterne non vengono conservati.'] }
  if (ext === 'txt') {
    const text = new TextDecoder().decode(data)
    const lines = text.split(/\r?\n/)
    if (lines.length > 50000) throw new Error('Il file contiene troppe righe (massimo 50.000).')
    const escape = (s: string) => s.replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!)
    return { title, content: lines.map(line => `<p>${escape(line)}</p>`).join(''), warnings: [] }
  }
  if (ext !== 'docx') throw new Error('Scegli un file .docx, .txt o .jscript. I vecchi file .doc non sono supportati.')
  checkDocxArchive(data)
  const imported = await importDocx(data)
  // Keep the same bounded tree contract as native files; raw XML never reaches the editor.
  const checked = validateNativeDocument(JSON.stringify({ format: 'jscript', version: 1, title, content: imported.content, layout: imported.layout }))
  return { ...checked, warnings: imported.warnings }

}

export function safeFilename(title: string): string {
  let name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 150).replace(/[. ]+$/g, '')
  if (!name) name = 'Senza titolo'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `Documento-${name}`
  return name
}

export function toNativeBytes(doc: StoredDocument): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify({ format: 'jscript', version: 1, title: doc.title, content: doc.content, updatedAt: doc.updatedAt, layout: normalizeLayout(doc.layout), ...(doc.importWarnings?.length ? { importWarnings: doc.importWarnings } : {}) }, null, 2))
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error('Il documento supera il limite di 25 MB. Riduci le dimensioni delle immagini prima di salvarlo.')
  return bytes
}

function hexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (/^#[\da-f]{6}$/i.test(value)) return value.slice(1)
  if (/^#[\da-f]{3}$/i.test(value)) return value.slice(1).split('').map(c => c + c).join('')
  const rgb = value.match(/^rgb\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)\s*\)$/i)
  if (rgb) return rgb.slice(1).map(v => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, '0')).join('')
  return undefined
}

function textRun(node: JSONContent, defaults: IRunOptions = {}): TextRun {
  const options: { -readonly [K in keyof IRunOptions]: IRunOptions[K] } = { ...defaults, text: node.text ?? '' }
  for (const mark of node.marks ?? []) {
    const attrs = mark.attrs ?? {}
    if (mark.type === 'bold') options.bold = true
    if (mark.type === 'italic') options.italics = true
    if (mark.type === 'underline') options.underline = {}
    if (mark.type === 'strike') options.strike = true
    if (mark.type === 'code') options.font = 'Consolas'
    if (mark.type === 'superscript') options.superScript = true
    if (mark.type === 'subscript') options.subScript = true
    if (mark.type === 'textStyle') {
      if (hexColor(attrs.color)) options.color = hexColor(attrs.color)
      if (typeof attrs.fontFamily === 'string') options.font = attrs.fontFamily.replace(/["']/g, '').split(',')[0].trim()
      if (typeof attrs.fontSize === 'string') {
        const size = parseFloat(attrs.fontSize) * (attrs.fontSize.endsWith('px') ? 0.75 : 1)
        if (Number.isFinite(size)) options.size = Math.round(Math.min(200, Math.max(4, size)) * 2)
      }
    }
    if (mark.type === 'highlight') options.shading = { type: ShadingType.CLEAR, fill: hexColor(attrs.color) ?? 'FFF2A8', color: 'auto' }
  }
  return new TextRun(options)
}

async function imageRun(node: JSONContent, maxWidth: number): Promise<ImageRun | TextRun> {
  const src = node.attrs?.src
  if (typeof src !== 'string' || !IMAGE_DATA.test(src)) return new TextRun('[Immagine non esportabile]')
  const bitmap = new Image()
  bitmap.src = src
  await bitmap.decode()
  const width = Math.min(Number(node.attrs?.width) || bitmap.naturalWidth || 400, maxWidth)
  const height = width * ((Number(node.attrs?.height) || bitmap.naturalHeight || 300) / (Number(node.attrs?.width) || bitmap.naturalWidth || 400))
  let source = src
  if (src.startsWith('data:image/webp')) {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.naturalWidth
    canvas.height = bitmap.naturalHeight
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    source = canvas.toDataURL('image/png')
  }
  const bytes = Uint8Array.from(atob(source.split(',')[1]), c => c.charCodeAt(0))
  return new ImageRun({ type: /^data:image\/jpe?g/i.test(source) ? 'jpg' : 'png', data: bytes, transformation: { width, height }, altText: { title: node.attrs?.alt ?? '', description: node.attrs?.alt ?? '', name: 'Immagine' } })
}

/** Semantic DOCX export. This is not a lossless Word round trip: advanced layouts,
 * floating objects, tracked changes, comments, headers and footers are not modeled.
 * Supported paragraph, character and table formatting survives export; unsupported Word objects do not.
 */
export async function toDocx(doc: StoredDocument): Promise<Uint8Array> {
  const layout = normalizeLayout(doc.layout)
  const dimensions = pageDimensions(layout)
  // docx swaps the supplied portrait dimensions itself for landscape sections.
  const portrait = pageDimensions({ ...layout, orientation: 'portrait' })
  const mmToTwips = (mm: number) => Math.round(mm * 1440 / 25.4)
  const imageMaxWidth = (dimensions.width - layout.margins.left - layout.margins.right) * 96 / 25.4
  const paragraphSpacing = {
    before: Math.round(layout.paragraphBefore * 20),
    after: Math.round(layout.paragraphAfter * 20),
    line: Math.round(layout.lineSpacing * 240),
    lineRule: LineRuleType.AUTO,
  }
  const numbering: INumberingOptions['config'][number] [] = []
  type Context = { level?: number; bullet?: boolean; reference?: string; quote?: boolean; maxWidth?: number }
  const alignment = (value: unknown) => ({ left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED })[String(value) as 'left']
  const runs = async (nodes: JSONContent[], maxWidth: number, defaults: IRunOptions = {}): Promise<(TextRun | ImageRun | ExternalHyperlink)[]> => Promise.all(nodes.map(node => {
    if (node.type === 'hardBreak') return new TextRun({ break: 1 })
    if (node.type === 'image') return imageRun(node, maxWidth)
    const run = textRun(node, defaults)
    const href = node.marks?.find(mark => mark.type === 'link')?.attrs?.href
    return safeLink(href) ? new ExternalHyperlink({ children: [run], link: href }) : run
  }))
  const wordBorder = (value: unknown): IBorderOptions | undefined => {
    if (typeof value !== 'string') return undefined
    const match = value.match(/^(\d+(?:\.\d+)?)pt (solid|double|dashed|dotted|none) (#[0-9a-f]{6})$/i)
    if (!match) return undefined
    const style = ({ solid: BorderStyle.SINGLE, double: BorderStyle.DOUBLE, dashed: BorderStyle.DASHED, dotted: BorderStyle.DOTTED, none: BorderStyle.NONE } as const)[match[2] as 'solid']
    return { style, size: Math.round(Number(match[1]) * 8), color: match[3].slice(1) }
  }
  const blocks = async (node: JSONContent, context: Context = {}): Promise<(Paragraph | Table)[]> => {
    const children = node.content ?? []
    const recurse = async (items: JSONContent[], ctx: Context = context) => (await Promise.all(items.map(child => blocks(child, ctx)))).flat()
    if (node.type === 'doc') return recurse(children)
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      let reference: string | undefined
      const level = Math.min(context.level === undefined ? 0 : context.level + 1, 8)
      if (node.type === 'orderedList') {
        reference = `list-${numbering.length + 1}`
        numbering.push({ reference, levels: Array.from({ length: 9 }, (_, index) => ({ level: index, format: LevelFormat.DECIMAL, text: `%${index + 1}.`, alignment: AlignmentType.LEFT, start: index === level ? Number(node.attrs?.start) || 1 : 1, style: { paragraph: { indent: { left: 720 * (index + 1), hanging: 360 } } } })) })
      }
      return recurse(children, { ...context, level, bullet: node.type === 'bulletList', reference })
    }
    if (node.type === 'listItem') {
      const result: (Paragraph | Table)[] = []
      for (let i = 0; i < children.length; i++) result.push(...await blocks(children[i], i === 0 || ['orderedList', 'bulletList'].includes(children[i].type ?? '') ? context : { ...context, reference: undefined, bullet: false }))
      return result
    }
    if (node.type === 'blockquote') return recurse(children, { ...context, quote: true })
    if (node.type === 'table') {
      // Grouping is an editor pagination detail. Word retains the rows and their cell rowSpan.
      const tableRows = children.flatMap(child => child.type === 'tableRowGroup' ? child.content ?? [] : child.type === 'tableRow' ? [child] : [])
      const columns = node.attrs?.layout === 'columns' && tableRows.every(row => row.content?.length === 2 && row.content.every(cell => (cell.attrs?.colspan ?? 1) === 1 && (cell.attrs?.rowspan ?? 1) === 1))
      const size = columnPercentages(node.attrs?.columnSize)
      const percentages = size ? size.split(',').map(Number) : columns ? [50, 50] : undefined
      const tableAttrs = sanitizeWordAttributes('table', node.attrs ?? {})
      const widthPercent = typeof tableAttrs.wordWidth === 'number' ? tableAttrs.wordWidth : 100
      const tableWidth = (context.maxWidth ?? imageMaxWidth) * widthPercent / 100
      const total = percentages?.reduce((sum, value) => sum + value, 0) ?? 100
      const widths = percentages?.map(value => Math.max(1, Math.round(tableWidth * 15 * value / total)))
      const noBorder = { style: BorderStyle.NONE, size: 0, color: 'auto' }
      const cellBorders = { top: noBorder, right: noBorder, bottom: noBorder, left: noBorder }
      const occupied: number[] = []
      const cellStarts = tableRows.map(row => {
        let column = 0
        const starts = (row.content ?? []).map(cell => {
          while (occupied[column] > 0) column++
          const start = column
          const span = Number(cell.attrs?.colspan) || 1
          for (let i = 0; i < span; i++) occupied[column++] = Number(cell.attrs?.rowspan) || 1
          return start
        })
        for (let i = 0; i < occupied.length; i++) occupied[i] = Math.max(0, occupied[i] - 1)
        return starts
      })
      const rows = await Promise.all(tableRows.map(async (row, rowIndex) => new TableRow({ ...(columns ? { cantSplit: false } : {}), children: await Promise.all((row.content ?? []).map(async (cell, index) => {
        const cellAttrs = sanitizeWordAttributes(cell.type ?? 'tableCell', cell.attrs ?? {})
        const span = Number(cell.attrs?.colspan) || 1
        const gridWidth = widths?.slice(cellStarts[rowIndex][index], cellStarts[rowIndex][index] + span).reduce((sum, value) => sum + value, 0)
        const padding = Number(cellAttrs.wordPaddingLeft ?? 0) + Number(cellAttrs.wordPaddingRight ?? 0)
        const cellWidth = gridWidth ? Math.max(1, gridWidth / 15 - (columns ? 4 * 96 / 25.4 : padding * 96 / 72)) : tableWidth
        const content = await recurse(cell.content ?? [], { maxWidth: cellWidth })
        if (!content.length || content[content.length - 1] instanceof Table) content.push(new Paragraph(''))
        return new TableCell({
          children: content, columnSpan: Number(cell.attrs?.colspan) || 1, rowSpan: Number(cell.attrs?.rowspan) || 1,
          ...(gridWidth ? { width: { size: gridWidth, type: WidthType.DXA } } : {}),
          ...(columns && widths ? {
            width: { size: widths[index], type: WidthType.DXA }, borders: cellBorders,
            margins: { top: 0, bottom: 0, left: index === 0 ? 0 : mmToTwips(4), right: index === 0 ? mmToTwips(4) : 0 },
          } : cell.type === 'tableHeader' ? { shading: { fill: 'F0F2F5', type: ShadingType.CLEAR } } : {}),
          ...(cellAttrs.wordFill ? { shading: { fill: String(cellAttrs.wordFill).slice(1), type: ShadingType.CLEAR } } : {}),
          ...(cellAttrs.wordVAlign ? { verticalAlign: ({ top: VerticalAlign.TOP, middle: VerticalAlign.CENTER, bottom: VerticalAlign.BOTTOM } as const)[cellAttrs.wordVAlign as 'top'] } : {}),
          ...(['Top', 'Right', 'Bottom', 'Left'].some(side => cellAttrs['wordBorder' + side] !== undefined) ? { borders: Object.fromEntries(['Top', 'Right', 'Bottom', 'Left'].map(side => [side.toLowerCase(), wordBorder(cellAttrs['wordBorder' + side])])) } : {}),
          ...(['Top', 'Right', 'Bottom', 'Left'].some(side => cellAttrs['wordPadding' + side] !== undefined) ? { margins: Object.fromEntries(['Top', 'Right', 'Bottom', 'Left'].filter(side => cellAttrs['wordPadding' + side] !== undefined).map(side => [side.toLowerCase(), Math.round(Number(cellAttrs['wordPadding' + side]) * 20)])) } : {}),
        })
      })) })))
      return rows.length ? [new Table({
        rows, width: { size: widthPercent, type: WidthType.PERCENTAGE },
        ...(widths ? { columnWidths: widths, layout: TableLayoutType.FIXED } : {}),
        ...(tableAttrs.wordAlign ? { alignment: alignment(tableAttrs.wordAlign) } : {}),
        ...(typeof tableAttrs.wordIndent === 'number' ? { indent: { size: Math.round(tableAttrs.wordIndent * 20), type: WidthType.DXA } } : {}),
        ...(columns ? { columnWidths: widths, layout: TableLayoutType.FIXED, borders: { ...cellBorders, insideHorizontal: noBorder, insideVertical: noBorder } } : {}),
      })] : []
    }
    if (node.type === 'image') return [new Paragraph({ children: [await imageRun(node, context.maxWidth ?? imageMaxWidth)] })]
    if (node.type === 'horizontalRule') return [new Paragraph({ border: { bottom: { color: 'CCD2DC', size: 6, style: BorderStyle.SINGLE } } })]
    if (['paragraph', 'heading', 'codeBlock'].includes(node.type ?? '')) {
      const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
      const word = sanitizeWordAttributes(node.type ?? 'paragraph', node.attrs ?? {})
      const imported = word.wordFontSize !== undefined
      const runDefaults: IRunOptions = imported ? { bold: false, italics: false, size: Math.round(Number(word.wordFontSize) * 2), ...(word.wordFontFamily ? { font: String(word.wordFontFamily).replace(/["']/g, '').split(',')[0].trim() } : {}) } : {}
      const spacing: NonNullable<IParagraphOptions['spacing']> = {
        ...(node.type === 'heading' ? { before: 0, after: 160, line: 276, lineRule: LineRuleType.AUTO } : paragraphSpacing),
        ...(typeof word.wordBefore === 'number' ? { before: Math.round(word.wordBefore * 20) } : {}),
        ...(typeof word.wordAfter === 'number' ? { after: Math.round(word.wordAfter * 20) } : {}),
        ...(typeof word.wordLine === 'number' ? { line: Math.round(word.wordLine * 240), lineRule: LineRuleType.AUTO } : {}),
        ...(typeof word.wordLinePt === 'number' ? { line: Math.round(word.wordLinePt * 20), lineRule: LineRuleType.EXACT } : {}),
      }
      const options: IParagraphOptions = {
        children: await runs(children, context.maxWidth ?? imageMaxWidth, runDefaults), alignment: alignment(node.attrs?.textAlign),
        spacing,
        ...(imported ? { run: runDefaults } : {}),
        ...(typeof word.wordKeepNext === 'boolean' ? { keepNext: word.wordKeepNext } : {}),
        ...(node.type === 'heading' ? { heading: levels[Math.max(0, Math.min(5, Number(node.attrs?.level ?? 1) - 1))] } : {}),
        ...(context.bullet ? { bullet: { level: context.level ?? 0 } } : {}),
        ...(context.reference ? { numbering: { reference: context.reference, level: context.level ?? 0 } } : {}),
        ...(context.quote ? { indent: { left: 360 }, border: { left: { color: 'DFD5FF', size: 18, style: BorderStyle.SINGLE, space: 10 } } } : {}),
        ...(['wordIndentLeft', 'wordIndentRight', 'wordIndentFirst'].some(key => word[key] !== undefined) ? { indent: {
          ...(typeof word.wordIndentLeft === 'number' ? { left: Math.round(word.wordIndentLeft * 20) } : {}),
          ...(typeof word.wordIndentRight === 'number' ? { right: Math.round(word.wordIndentRight * 20) } : {}),
          ...(typeof word.wordIndentFirst === 'number' ? word.wordIndentFirst < 0 ? { hanging: Math.round(-word.wordIndentFirst * 20) } : { firstLine: Math.round(word.wordIndentFirst * 20) } : {}),
        } } : {}),
      }
      return [new Paragraph(options)]
    }
    return recurse(children)
  }
  const children = await blocks(doc.content)
  const file = new Document({
    creator: 'JScript', title: doc.title, description: 'Creato con JScript', numbering: { config: numbering },
    styles: { default: { document: { run: { font: 'Calibri', size: 24 }, paragraph: { spacing: paragraphSpacing } } } },
    sections: [{
      properties: { page: {
        size: { width: mmToTwips(portrait.width), height: mmToTwips(portrait.height), orientation: layout.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
        margin: { top: mmToTwips(layout.margins.top), right: mmToTwips(layout.margins.right), bottom: mmToTwips(layout.margins.bottom), left: mmToTwips(layout.margins.left) },
      } },
      children: children.length ? children : [new Paragraph('')],
    }],
  })
  return new Uint8Array(await (await Packer.toBlob(file)).arrayBuffer())
}
