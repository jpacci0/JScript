import { useEffect, useState } from 'react'
import { Extension, type Editor } from '@tiptap/core'
import { Fragment, type Node as ProseMirrorNode, type ResolvedPos } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export type ColumnsRatio = 'equal' | 'sidebar'
export type ColumnsState = {
  active: boolean
  ratio: ColumnsRatio
  pos: number | null
  canInsert: boolean
  canSplit: boolean
}
export type ColumnOverflow = { overflow: boolean; pos: number | null }

type LocatedTable = { node: ProseMirrorNode; pos: number }
type LocatedRow = { node: ProseMirrorNode; pos: number; index: number }
const widths = (ratio: ColumnsRatio) => ratio === 'sidebar' ? '33.333,66.667' : '50,50'
const ratioOf = (node: ProseMirrorNode): ColumnsRatio =>
  Number(String(node.attrs.columnSize || '50,50').split(',')[0]) < 42 ? 'sidebar' : 'equal'

function tableAtSelection(state: EditorState): LocatedTable | null {
  const { selection } = state
  if (selection instanceof NodeSelection && selection.node.type.name === 'table') {
    return { node: selection.node, pos: selection.from }
  }
  const { $from, to } = selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'table') {
      const pos = $from.before(depth)
      return to <= pos + node.nodeSize ? { node, pos } : null
    }
  }
  return null
}

function rowsOf(table: LocatedTable): LocatedRow[] {
  const rows: LocatedRow[] = []
  table.node.forEach((child, offset) => {
    if (child.type.name === 'tableRow') rows.push({ node: child, pos: table.pos + 1 + offset, index: rows.length })
    else if (child.type.name === 'tableRowGroup') child.forEach((row, rowOffset) => {
      if (row.type.name === 'tableRow') rows.push({ node: row, pos: table.pos + 2 + offset + rowOffset, index: rows.length })
    })
  })
  return rows
}

function columnsAtSelection(state: EditorState): LocatedTable | null {
  const table = tableAtSelection(state)
  return table?.node.attrs.layout === 'columns' ? table : null
}

function rowAtSelection(state: EditorState, table: LocatedTable): LocatedRow | null {
  return rowsOf(table).find(row => state.selection.from >= row.pos && state.selection.to <= row.pos + row.node.nodeSize) ?? null
}

function splitLocation(state: EditorState) {
  if (!state.selection.empty) return null
  const table = columnsAtSelection(state)
  if (!table) return null
  const { $from } = state.selection
  // Splitting lists or nested containers needs their own structural rules.
  // This command intentionally acts only on a direct text block in a cell.
  if (!$from.parent.isTextblock || $from.depth < 2) return null
  const cell = $from.node($from.depth - 1)
  if (cell.type.name !== 'tableCell') return null
  const row = rowAtSelection(state, table)
  if (!row || row.node.childCount !== 2) return null
  const cellIndex = $from.index($from.depth - 2)
  return { table, row, cell, cellIndex, blockIndex: $from.index($from.depth - 1), offset: $from.parentOffset, block: $from.parent }
}

function topLevelRange(state: EditorState): { from: number; to: number; content: ProseMirrorNode[] } | null {
  const { $from, $to, from, to, empty } = state.selection
  const start = $from.depth > 0 ? $from.before(1) : from
  let end = $to.depth > 0 ? $to.after(1) : to
  // A selection ending at the beginning of the next top-level block should
  // not pull that unselected block into the left column.
  if (!empty && $to.depth === 1 && $to.parentOffset === 0 && $to.before(1) > start) end = $to.before(1)
  const content: ProseMirrorNode[] = []
  let hasTable = false
  state.doc.nodesBetween(start, end, (node, pos, parent) => {
    if (node.type.name === 'table') hasTable = true
    if (parent === state.doc && pos >= start && pos < end) content.push(node)
  })
  return hasTable || !content.length ? null : { from: start, to: end, content }
}

export function getColumnsState(editor: Editor | null): ColumnsState {
  if (!editor || editor.isDestroyed) return { active: false, ratio: 'equal', pos: null, canInsert: false, canSplit: false }
  const table = columnsAtSelection(editor.state)
  return {
    active: !!table, ratio: table ? ratioOf(table.node) : 'equal', pos: table?.pos ?? null,
    canInsert: !!table || (!tableAtSelection(editor.state) && !!topLevelRange(editor.state)),
    canSplit: !!splitLocation(editor.state),
  }
}

function emptyCell(state: EditorState) {
  return state.schema.nodes.tableCell.create(null, state.schema.nodes.paragraph.create())
}

function focusTransaction(editor: Editor, tr: EditorState['tr'], pos: number) {
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, Math.min(pos, tr.doc.content.size))), 1)).scrollIntoView()
  editor.view.dispatch(tr)
  editor.commands.focus()
  return true
}

/** Convert the selected top-level blocks, or change the current column ratio. */
export function insertOrUpdateColumns(editor: Editor, ratio: ColumnsRatio): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false
  const current = columnsAtSelection(editor.state)
  if (current) {
    editor.view.dispatch(editor.state.tr.setNodeMarkup(current.pos, undefined, { ...current.node.attrs, columnSize: widths(ratio) }))
    editor.commands.focus()
    return true
  }
  if (tableAtSelection(editor.state)) return false
  const range = topLevelRange(editor.state)
  if (!range) return false
  const { schema, tr } = editor.state
  const left = schema.nodes.tableCell.create(null, range.content)
  const row = schema.nodes.tableRow.create(null, [left, emptyCell(editor.state)])
  const table = schema.nodes.table.create({ layout: 'columns', columnSize: widths(ratio) }, row)
  tr.replaceWith(range.from, range.to, table)
  return focusTransaction(editor, tr, range.from + 4)
}

/** Flatten every section in reading order, preserving its blocks and marks. */
export function unwrapColumns(editor: Editor): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false
  const table = columnsAtSelection(editor.state)
  if (!table) return false
  const blocks: ProseMirrorNode[] = []
  for (const row of rowsOf(table)) row.node.forEach(cell => cell.forEach(block => blocks.push(block)))
  if (!blocks.length) blocks.push(editor.state.schema.nodes.paragraph.create())
  const tr = editor.state.tr.replaceWith(table.pos, table.pos + table.node.nodeSize, Fragment.fromArray(blocks))
  return focusTransaction(editor, tr, table.pos + 1)
}

function replaceRows(editor: Editor, table: LocatedTable, rows: ProseMirrorNode[], focusRow: number, focusCell = 0) {
  // Rebuild direct rows and retain table attrs. TablePlus's grouping plugin
  // recreates attrs when it changes rowspan groups; column sections have no
  // spans and therefore never need that grouping operation.
  const next = table.node.type.create(table.node.attrs, rows, table.node.marks)
  const tr = editor.state.tr.replaceWith(table.pos, table.pos + table.node.nodeSize, next)
  let pos = table.pos + 1
  for (let index = 0; index < focusRow; index++) pos += rows[index].nodeSize
  pos += 1
  for (let index = 0; index < focusCell; index++) pos += rows[focusRow].child(index).nodeSize
  return focusTransaction(editor, tr, pos + 2)
}

/** Add two empty cells after the current section, without nesting a table. */
export function addColumnSection(editor: Editor): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false
  const table = columnsAtSelection(editor.state)
  if (!table) return false
  const rows = rowsOf(table).map(row => row.node)
  const current = rowAtSelection(editor.state, table)
  const index = current ? current.index + 1 : rows.length
  const row = editor.state.schema.nodes.tableRow.create(null, [emptyCell(editor.state), emptyCell(editor.state)])
  rows.splice(index, 0, row)
  return replaceRows(editor, table, rows, index)
}

/** Continue this cell in the same column of the next section, at the caret. */
export function splitColumnSection(editor: Editor): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false
  const location = splitLocation(editor.state)
  if (!location) return false
  const { table, row, cell, cellIndex, blockIndex, offset, block } = location
  const before: ProseMirrorNode[] = []
  const after: ProseMirrorNode[] = []
  cell.forEach((child, _offset, index) => {
    if (index < blockIndex) before.push(child)
    else if (index > blockIndex) after.push(child)
  })
  if (offset > 0) before.push(block.copy(block.content.cut(0, offset)))
  const remaining = offset < block.content.size ? block.copy(block.content.cut(offset)) : editor.state.schema.nodes.paragraph.create()
  after.unshift(remaining)
  if (!before.length) before.push(editor.state.schema.nodes.paragraph.create())
  const oldCells = [row.node.child(0), row.node.child(1)]
  oldCells[cellIndex] = cell.copy(Fragment.fromArray(before))
  const nextCells = [emptyCell(editor.state), emptyCell(editor.state)]
  nextCells[cellIndex] = cell.copy(Fragment.fromArray(after))
  const rows = rowsOf(table).map(item => item.node)
  rows.splice(row.index, 1, row.node.copy(Fragment.fromArray(oldCells)), row.node.type.create(row.node.attrs, nextCells))
  return replaceRows(editor, table, rows, row.index + 1, cellIndex)
}

function nextCellPosition(state: EditorState, backwards: boolean): number | null {
  const table = columnsAtSelection(state)
  if (!table) return null
  const positions: number[] = []
  for (const row of rowsOf(table)) {
    row.node.forEach((_cell, offset) => positions.push(row.pos + 1 + offset))
  }
  const { $from } = state.selection
  let cellPos: number | null = null
  for (let depth = $from.depth; depth > 0; depth--) {
    if (['tableCell', 'tableHeader'].includes($from.node(depth).type.name)) { cellPos = $from.before(depth); break }
  }
  const index = positions.indexOf(cellPos ?? -1)
  return index >= 0 ? positions[index + (backwards ? -1 : 1)] ?? null : null
}

/** Attributes serialize; the decoration styles TablePlus's custom outer DOM. */
export const ColumnSections = Extension.create({
  name: 'columnSections',
  priority: 1100,
  addGlobalAttributes() {
    return [{ types: ['table'], attributes: {
      layout: {
        default: null,
        parseHTML: element => element.getAttribute('data-jscript-layout') === 'columns' ? 'columns' : null,
        renderHTML: attrs => attrs.layout === 'columns' ? { 'data-jscript-layout': 'columns' } : {},
      },
    } }]
  },
  addKeyboardShortcuts() {
    const move = (backwards: boolean) => {
      if (!columnsAtSelection(this.editor.state)) return false
      const next = nextCellPosition(this.editor.state, backwards)
      if (next !== null) return focusTransaction(this.editor, this.editor.state.tr, next + 2)
      if (!backwards) return addColumnSection(this.editor)
      // At the first cell, consume Shift+Tab instead of changing document structure.
      return true
    }
    return { Tab: () => move(false), 'Shift-Tab': () => move(true) }
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('jscriptColumnSections'),
      props: {
        decorations(state) {
          const decorations: Decoration[] = []
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'table' && node.attrs.layout === 'columns') {
              decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'jscript-columns', 'data-jscript-layout': 'columns' }))
              return false
            }
          })
          return DecorationSet.create(state.doc, decorations)
        },
      },
    })]
  },
})

function ancestorTable($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === 'table') return $pos.before(depth)
  return null
}

/** Reports an actually clipped cell; no document mutation is used for measuring. */
export function useColumnOverflow(editor: Editor | null): ColumnOverflow {
  const [value, setValue] = useState<ColumnOverflow>({ overflow: false, pos: null })
  useEffect(() => {
    if (!editor || editor.isDestroyed) { setValue({ overflow: false, pos: null }); return }
    const view = editor.view
    let frame = 0
    let stopped = false
    const update = () => {
      frame = 0
      if (stopped || editor.isDestroyed) return
      let pos: number | null = null
      for (const cell of view.dom.querySelectorAll<HTMLElement>('.jscript-columns td, .jscript-columns th')) {
        if (cell.scrollHeight <= cell.clientHeight + 2) continue
        try { pos = ancestorTable(view.state.doc.resolve(view.posAtDOM(cell, 0))) } catch { continue }
        if (pos !== null) break
      }
      setValue(previous => previous.pos === pos && previous.overflow === (pos !== null) ? previous : { overflow: pos !== null, pos })
    }
    const schedule = () => { if (!stopped && !frame) frame = requestAnimationFrame(update) }
    const resize = new ResizeObserver(schedule)
    resize.observe(view.dom)
    const mutation = new MutationObserver(schedule)
    mutation.observe(view.dom, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style'] })
    editor.on('transaction', schedule)
    document.fonts.ready.then(schedule)
    document.fonts.addEventListener('loadingdone', schedule)
    view.dom.addEventListener('load', schedule, true)
    schedule()
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
      editor.off('transaction', schedule)
      document.fonts.removeEventListener('loadingdone', schedule)
      view.dom.removeEventListener('load', schedule, true)
    }
  }, [editor])
  return value
}
