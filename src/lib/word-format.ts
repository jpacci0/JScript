import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction, type EditorState } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

type Attributes = Record<string, unknown>
type Styles = Record<string, string>
const paragraphTypes = new Set(['paragraph', 'heading'])
const cellTypes = new Set(['tableCell', 'tableHeader'])
const sides = ['Top', 'Right', 'Bottom', 'Left'] as const
const paragraphRanges: Record<string, readonly [number, number]> = {
  wordBefore: [0, 1584], wordAfter: [0, 1584], wordLine: [.5, 10], wordLinePt: [1, 300],
  wordIndentLeft: [-100, 1000], wordIndentRight: [-100, 1000], wordIndentFirst: [-100, 1000],
  wordFontSize: [4, 200],
}
const paragraphKeys = [...Object.keys(paragraphRanges), 'wordFontFamily', 'wordKeepNext']
const tableKeys = ['wordWidth', 'wordAlign', 'wordIndent']
const cellKeys = ['wordFill', 'wordVAlign', ...sides.map(side => `wordBorder${side}`), ...sides.map(side => `wordPadding${side}`)]

function record(value: unknown): Attributes {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Attributes : {}
}
function bounded(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? Math.round(value * 1000) / 1000 : undefined
}
/** Only actual font-family tokens; no CSS functions, escapes, declarations or URLs. */
function fontFamily(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 100) return undefined
  const families = value.split(',').map(item => item.trim())
  if (!families.length || families.length > 8) return undefined
  const safe: string[] = []
  for (let item of families) {
    if ((item.startsWith('"') && item.endsWith('"')) || (item.startsWith("'") && item.endsWith("'"))) item = item.slice(1, -1)
    if (!/^[\p{L}\p{N}_ -]{1,100}$/u.test(item) || !item.trim()) return undefined
    item = item.trim().replace(/ +/g, ' ')
    safe.push(item.includes(' ') ? `"${item}"` : item)
  }
  const result = safe.join(', ')
  return result.length <= 100 ? result : undefined
}
function hex(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) return undefined
  return (value.length === 4 ? '#' + [...value.slice(1)].map(char => char + char).join('') : value).toUpperCase()
}
function border(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 70) return undefined
  const match = /^(\d+(?:\.\d{1,3})?)pt (solid|double|dashed|dotted|none) (#[\da-f]{6})$/i.exec(value)
  if (!match || Number(match[1]) > 24) return undefined
  return `${Number(match[1])}pt ${match[2].toLowerCase()} ${match[3].toUpperCase()}`
}

/** Rebuild only typed Word attributes. Missing fields preserve legacy document defaults. */
export function sanitizeWordAttributes(type: string, value: unknown): Attributes {
  const source = record(value)
  const result: Attributes = {}
  const numeric = (name: string, min: number, max: number) => {
    const safe = bounded(source[name], min, max)
    if (safe !== undefined) result[name] = safe
  }
  if (paragraphTypes.has(type)) {
    for (const [name, [min, max]] of Object.entries(paragraphRanges)) numeric(name, min, max)
    // An explicit point height has priority if a malformed document supplies both.
    if (result.wordLinePt !== undefined) delete result.wordLine
    const family = fontFamily(source.wordFontFamily)
    if (family !== undefined) result.wordFontFamily = family
    if (typeof source.wordKeepNext === 'boolean') result.wordKeepNext = source.wordKeepNext
  }
  if (type === 'table') {
    numeric('wordWidth', 1, 100)
    numeric('wordIndent', 0, 500)
    if (typeof source.wordAlign === 'string' && ['left', 'center', 'right'].includes(source.wordAlign)) result.wordAlign = source.wordAlign
  }
  if (cellTypes.has(type)) {
    const fill = hex(source.wordFill)
    if (fill !== undefined) result.wordFill = fill
    if (typeof source.wordVAlign === 'string' && ['top', 'middle', 'bottom'].includes(source.wordVAlign)) result.wordVAlign = source.wordVAlign
    for (const side of sides) {
      const safeBorder = border(source[`wordBorder${side}`])
      if (safeBorder !== undefined) result[`wordBorder${side}`] = safeBorder
      numeric(`wordPadding${side}`, 0, 100)
    }
  }
  return result
}

function wordStyles(type: string, value: unknown): Styles {
  const attrs = sanitizeWordAttributes(type, value)
  const styles: Styles = {}
  const pt = (key: string, property: string) => { if (attrs[key] !== undefined) styles[property] = `${attrs[key]}pt` }
  if (paragraphTypes.has(type)) {
    pt('wordBefore', 'margin-top'); pt('wordAfter', 'margin-bottom')
    pt('wordIndentLeft', 'margin-left'); pt('wordIndentRight', 'margin-right'); pt('wordIndentFirst', 'text-indent')
    if (attrs.wordLine !== undefined) styles['line-height'] = String(attrs.wordLine)
    pt('wordLinePt', 'line-height')
    pt('wordFontSize', 'font-size')
    if (attrs.wordFontFamily !== undefined) styles['font-family'] = String(attrs.wordFontFamily)
    if (attrs.wordKeepNext !== undefined) {
      styles['break-after'] = attrs.wordKeepNext ? 'avoid' : 'auto'
      styles['page-break-after'] = attrs.wordKeepNext ? 'avoid' : 'auto'
    }
    if (type === 'heading' && Object.keys(attrs).length) {
      styles['font-weight'] = '400'; styles['letter-spacing'] = 'normal'; styles.color = 'inherit'
    }
  }
  if (type === 'table') {
    if (attrs.wordWidth !== undefined) styles.width = `${attrs.wordWidth}%`
    if (attrs.wordAlign === 'center') { styles['margin-left'] = 'auto'; styles['margin-right'] = 'auto' }
    else if (attrs.wordAlign === 'right') { styles['margin-left'] = 'auto'; styles['margin-right'] = '0pt' }
    else if (attrs.wordAlign === 'left') { styles['margin-left'] = '0pt'; styles['margin-right'] = 'auto' }
    if (attrs.wordIndent !== undefined && (!attrs.wordAlign || attrs.wordAlign === 'left')) styles['margin-left'] = `${attrs.wordIndent}pt`
  }
  if (cellTypes.has(type)) {
    if (attrs.wordFill !== undefined) styles['background-color'] = String(attrs.wordFill)
    if (attrs.wordVAlign !== undefined) styles['vertical-align'] = String(attrs.wordVAlign)
    for (const side of sides) {
      if (attrs[`wordBorder${side}`] !== undefined) styles[`border-${side.toLowerCase()}`] = `${attrs[`wordBorder${side}`]} !important`
      pt(`wordPadding${side}`, `padding-${side.toLowerCase()}`)
    }
  }
  return styles
}
function styleText(styles: Styles): string { return Object.entries(styles).map(([property, value]) => `${property}:${value}`).join(';') }
export function paragraphStyle(value: unknown, type: 'paragraph' | 'heading' = 'paragraph'): string { return styleText(wordStyles(type, value)) }
export function tableStyle(value: unknown): string { return styleText(wordStyles('table', value)) }
export function cellStyle(value: unknown): string { return styleText(wordStyles('tableCell', value)) }

/** Parse lengths from CSSOM, never arbitrary CSS text or computed/inherited page styles. */
function points(value: string): number | undefined {
  const match = /^(-?\d+(?:\.\d+)?)(pt|px|mm|cm|in)$/i.exec(value.trim())
  if (!match) return value.trim() === '0' ? 0 : undefined
  const factors: Record<string, number> = { pt: 1, px: .75, mm: 72 / 25.4, cm: 72 / 2.54, in: 72 }
  return Number(match[1]) * factors[match[2].toLowerCase()]
}
function cssColor(value: string): string | undefined {
  const direct = hex(value.trim())
  if (direct) return direct
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(value.trim())
  if (!rgb || rgb.slice(1).some(channel => Number(channel) > 255)) return undefined
  return '#' + rgb.slice(1).map(channel => Number(channel).toString(16).padStart(2, '0')).join('').toUpperCase()
}
function cssBorder(element: HTMLElement, side: string): string | undefined {
  const name = side.toLowerCase()
  const style = element.style.getPropertyValue(`border-${name}-style`)
  if (!['solid', 'double', 'dashed', 'dotted', 'none'].includes(style)) return undefined
  const width = style === 'none' ? 0 : points(element.style.getPropertyValue(`border-${name}-width`))
  const color = cssColor(element.style.getPropertyValue(`border-${name}-color`)) || (style === 'none' ? '#000000' : undefined)
  return width !== undefined && color ? border(`${Math.round(width * 1000) / 1000}pt ${style} ${color}`) : undefined
}
function parseStyles(type: string, element: HTMLElement): Attributes {
  const style = element.style
  const attrs: Attributes = {}
  if (paragraphTypes.has(type)) {
    attrs.wordBefore = points(style.marginTop); attrs.wordAfter = points(style.marginBottom)
    attrs.wordIndentLeft = points(style.marginLeft); attrs.wordIndentRight = points(style.marginRight); attrs.wordIndentFirst = points(style.textIndent)
    attrs.wordFontSize = points(style.fontSize); attrs.wordFontFamily = style.fontFamily
    if (/^\d+(?:\.\d+)?$/.test(style.lineHeight)) attrs.wordLine = Number(style.lineHeight)
    else attrs.wordLinePt = points(style.lineHeight)
    const keep = style.breakAfter || style.pageBreakAfter
    if (keep === 'avoid' || keep === 'avoid-page') attrs.wordKeepNext = true
    if (keep === 'auto') attrs.wordKeepNext = false
  }
  if (type === 'table') {
    if (/^\d+(?:\.\d+)?%$/.test(style.width)) attrs.wordWidth = Number(style.width.slice(0, -1))
    if (style.marginLeft === 'auto' && style.marginRight === 'auto') attrs.wordAlign = 'center'
    else if (style.marginLeft === 'auto') attrs.wordAlign = 'right'
    else if (style.marginRight === 'auto') attrs.wordAlign = 'left'
    attrs.wordIndent = points(style.marginLeft)
  }
  if (cellTypes.has(type)) {
    attrs.wordFill = cssColor(style.backgroundColor); attrs.wordVAlign = style.verticalAlign
    for (const side of sides) {
      attrs[`wordBorder${side}`] = cssBorder(element, side)
      attrs[`wordPadding${side}`] = points(style.getPropertyValue(`padding-${side.toLowerCase()}`))
    }
  }
  return sanitizeWordAttributes(type, attrs)
}
function attribute(type: string, key: string) {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => parseStyles(type, element)[key] ?? null,
    renderHTML: (attributes: Attributes) => {
      const attrs = sanitizeWordAttributes(type, attributes)
      if (attrs[key] === undefined) return {}
      // Render all known styles once, under the first present attribute. Tiptap
      // merges global attributes; this avoids duplicate CSS declarations.
      const keys = paragraphTypes.has(type) ? paragraphKeys : type === 'table' ? tableKeys : cellKeys
      if (keys.find(name => attrs[name] !== undefined) !== key) return {}
      return {
        'data-word-format': 'true',
        // A Word list's hanging indent positions its marker. Keep the stored
        // value for round trips; CSS handles the first list paragraph's text.
        ...(typeof attrs.wordIndentFirst === 'number' && attrs.wordIndentFirst < 0 ? { 'data-word-hanging': 'true' } : {}),
        ...(attrs.wordVAlign ? { 'data-word-valign': attrs.wordVAlign } : {}),
        style: styleText(wordStyles(type, attrs)),
      }
    },
  }
}

function rows(node: ProseMirrorNode): ProseMirrorNode[] {
  const result: ProseMirrorNode[] = []
  node.forEach(child => {
    if (child.type.name === 'tableRow') result.push(child)
    else if (child.type.name === 'tableRowGroup') child.forEach(row => result.push(row))
  })
  return result
}
function rowShape(node: ProseMirrorNode): string {
  const shape: number[] = []
  node.forEach(child => shape.push(child.type.name === 'tableRowGroup' ? child.childCount : 1))
  return shape.join(',')
}
function sameRows(a: ProseMirrorNode, b: ProseMirrorNode): boolean {
  const left = rows(a), right = rows(b)
  return left.length === right.length && left.every((row, index) => row.eq(right[index]))
}
/** TablePlus rebuilds tables with default attrs when grouping rows for rowspans. */
function preserveGroupedTableAttrs(transactions: readonly Transaction[], viewState: EditorState) {
  const result = viewState.tr
  for (let transactionIndex = 0; transactionIndex < transactions.length; transactionIndex++) {
    const transaction = transactions[transactionIndex]
    for (let stepIndex = 0; stepIndex < transaction.steps.length; stepIndex++) {
      const step = transaction.steps[stepIndex]
      if (!(step instanceof ReplaceStep) || step.slice.openStart || step.slice.openEnd || step.slice.content.childCount !== 1) continue
      const before = transaction.docs[stepIndex].nodeAt(step.from)
      const replacement = step.slice.content.firstChild
      if (!before || !replacement || before.type.name !== 'table' || replacement.type.name !== 'table' || step.to !== step.from + before.nodeSize) continue
      if (rowShape(before) === rowShape(replacement) || !sameRows(before, replacement)) continue
      let position = step.from
      for (let index = stepIndex + 1; index < transaction.mapping.maps.length; index++) position = transaction.mapping.maps[index].map(position, 1)
      for (let index = transactionIndex + 1; index < transactions.length; index++) position = transactions[index].mapping.map(position, 1)
      const current = result.doc.nodeAt(position)
      if (!current || current.type.name !== 'table' || !sameRows(before, current)) continue
      const restored = { ...current.attrs }
      let changed = false
      for (const key of [...tableKeys, 'columnSize', 'layout']) {
        const oldValue = before.attrs[key], nextValue = current.attrs[key]
        if (oldValue !== undefined && oldValue !== null && oldValue !== '' && (nextValue === null || nextValue === undefined || nextValue === '')) {
          restored[key] = oldValue; changed = true
        }
      }
      if (changed) result.setNodeMarkup(position, undefined, restored)
    }
  }
  return result.docChanged ? result : null
}

/** Rowspan groups are separate native tables inside TablePlus's grid wrapper. */
function groupedCellWidths(table: ProseMirrorNode, tablePosition: number, output: Map<number, string>) {
  const source = typeof table.attrs.columnSize === 'string' ? table.attrs.columnSize.split(',').map(Number) : []
  if (!source.length || source.length > 100 || source.some(value => !Number.isFinite(value) || value <= 0 || value > 100)) return
  const sum = source.reduce((total, value) => total + value, 0)
  const percentages = source.map(value => value / sum * 100)
  const rowList: { node: ProseMirrorNode; position: number; grouped: boolean }[] = []
  table.forEach((child, offset) => {
    if (child.type.name === 'tableRow') rowList.push({ node: child, position: tablePosition + 1 + offset, grouped: false })
    else if (child.type.name === 'tableRowGroup') child.forEach((row, rowOffset) => rowList.push({ node: row, position: tablePosition + 2 + offset + rowOffset, grouped: true }))
  })
  const occupied: number[] = []
  for (const row of rowList) {
    let column = 0
    row.node.forEach((cell, cellOffset) => {
      while (occupied[column] > 0) column++
      const span = bounded(cell.attrs.colspan, 1, 100) ?? 1
      const rowspan = bounded(cell.attrs.rowspan, 1, 100) ?? 1
      if (row.grouped && column + span <= percentages.length) {
        const width = percentages.slice(column, column + span).reduce((total, value) => total + value, 0)
        output.set(row.position + 1 + cellOffset, `${Math.round(width * 1000000) / 1000000}%`)
      }
      for (let index = column; index < column + span; index++) occupied[index] = rowspan
      column += span
    })
    for (let index = 0; index < occupied.length; index++) if (occupied[index] > 0) occupied[index]--
  }
}
export const WordFormatting = Extension.create({
  name: 'wordFormatting',
  addGlobalAttributes() {
    return [
      ...['paragraph', 'heading'].map(type => ({ types: [type], attributes: Object.fromEntries(paragraphKeys.map(key => [key, attribute(type, key)])) })),
      { types: ['table'], attributes: Object.fromEntries(tableKeys.map(key => [key, attribute('table', key)])) },
      { types: ['tableCell', 'tableHeader'], attributes: Object.fromEntries(cellKeys.map(key => [key, attribute('tableCell', key)])) },
    ]
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('jscriptWordFormatting'),
      appendTransaction: (transactions, _oldState, newState) => preserveGroupedTableAttrs(transactions, newState),
      props: {
        decorations: state => {
          const decorations: Decoration[] = []
          const widths = new Map<number, string>()
          state.doc.descendants((node, position) => { if (node.type.name === 'table') groupedCellWidths(node, position, widths) })
          state.doc.descendants((node, position) => {
            if (node.type.name !== 'table' && !cellTypes.has(node.type.name)) return
            const attrs = sanitizeWordAttributes(node.type.name, node.attrs)
            const domAttrs: Record<string, string> = {}
            if (Object.keys(attrs).length) {
              domAttrs['data-word-format'] = 'true'
              domAttrs.style = styleText(wordStyles(node.type.name, attrs))
              if (attrs.wordVAlign) domAttrs['data-word-valign'] = String(attrs.wordVAlign)
            }
            const cellWidth = widths.get(position)
            if (cellWidth) domAttrs.style = (domAttrs.style ? domAttrs.style + ';' : '') + 'width:' + cellWidth
            // TablePlus updates colspan but otherwise leaves rowSpan stale.
            if (cellTypes.has(node.type.name)) domAttrs.rowspan = String(bounded(node.attrs.rowspan, 1, 100) ?? 1)
            if (Object.keys(domAttrs).length) decorations.push(Decoration.node(position, position + node.nodeSize, domAttrs))
          })
          // Outer node decorations also style TablePlus's custom node views.
          // ProseMirror owns these DOM writes, so its observer cannot interpret
          // presentation changes as fresh edits and recreate cells in a loop.
          return DecorationSet.create(state.doc, decorations)
        },
      },
    })]
  },
})