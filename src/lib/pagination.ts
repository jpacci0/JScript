import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { PaginationPlus } from 'tiptap-pagination-plus'
import { normalizeLayout, pageDimensions } from './layout'
import type { DocumentLayout } from './types'

const px = (mm: number) => mm * 96 / 25.4
const PAGE_GAP = 28
const injectedStyles = new WeakMap<Editor, HTMLStyleElement>()
const DocumentPagination = PaginationPlus.extend({
  onCreate(event) {
    const existing = new Set(document.querySelectorAll('style[data-rm-pagination-style]'))
    this.parent?.(event)
    const style = Array.from(document.querySelectorAll<HTMLStyleElement>('style[data-rm-pagination-style]')).find(item => !existing.has(item))
    if (style) injectedStyles.set(this.editor, style)
  },
  onDestroy() {
    injectedStyles.get(this.editor)?.remove()
    injectedStyles.delete(this.editor)
  },
})

/** Pagination lives in view decorations; the editable document stays a single tree. */
export function paginationExtension(value: DocumentLayout) {
  const layout = normalizeLayout(value)
  const size = pageDimensions(layout)
  return DocumentPagination.configure({
    pageHeight: px(size.height), pageWidth: px(size.width), pageGap: PAGE_GAP,
    marginTop: px(layout.margins.top), marginBottom: px(layout.margins.bottom),
    marginLeft: px(layout.margins.left), marginRight: px(layout.margins.right),
    contentMarginTop: 0, contentMarginBottom: 0,
    headerLeft: '', headerRight: '', footerLeft: '', footerRight: '',
    pageBreakBackground: 'var(--canvas)', pageGapBorderColor: '#e7e3ec', pageGapBorderSize: 1,
  })
}

export function usePagination(editor: Editor | null, value: DocumentLayout) {
  const [pages, setPages] = useState({ pageCount: 1, currentPage: 1 })
  const signature = JSON.stringify(normalizeLayout(value))

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const layout: DocumentLayout = JSON.parse(signature)
    const size = pageDimensions(layout)
    editor.chain().updatePageHeight(px(size.height)).updatePageWidth(px(size.width))
      .updateMargins({ top: px(layout.margins.top), bottom: px(layout.margins.bottom), left: px(layout.margins.left), right: px(layout.margins.right) })
      .command(({ tr }) => { tr.setMeta('addToHistory', false); return true }).run()
  }, [editor, signature])

  useEffect(() => {
    if (!editor) return
    const view = editor.view
    const dom = view.dom
    let frame = 0
    let stopped = false
    let reflow = false
    const update = () => {
      frame = 0
      if (stopped || editor.isDestroyed) return
      if (reflow) {
        reflow = false
        view.dispatch(view.state.tr.setMeta('paginationReflow', true).setMeta('addToHistory', false))
      }
      const pageCount = Math.max(1, dom.querySelectorAll('[data-rm-pagination] > .rm-page-break').length)
      let currentPage = 1
      if (dom.isConnected) {
        const rect = dom.getBoundingClientRect()
        const scale = rect.width / (dom.offsetWidth || rect.width) || 1
        const caret = view.coordsAtPos(view.state.selection.head)
        const height = editor.storage.PaginationPlus.pageHeight + PAGE_GAP
        currentPage = Math.max(1, Math.min(pageCount, Math.floor((caret.top - rect.top) / scale / height) + 1))
        // Reflow can move the caret after ProseMirror's normal scrolling pass.
        // Only follow an active editing caret; changing Layout should keep its focus.
        const scroll = dom.closest('.editor-scroll')
        if (editor.isFocused && scroll) {
          const bounds = scroll.getBoundingClientRect()
          if (caret.bottom > bounds.bottom - 20) scroll.scrollTop += caret.bottom - bounds.bottom + 20
          else if (caret.top < bounds.top + 20) scroll.scrollTop -= bounds.top + 20 - caret.top
        }
      }
      setPages(previous => previous.pageCount === pageCount && previous.currentPage === currentPage ? previous : { pageCount, currentPage })
    }
    const schedule = () => { if (!stopped && !frame) frame = requestAnimationFrame(update) }
    const scheduleReflow = () => { reflow = true; schedule() }
    const mutation = new MutationObserver(schedule)
    mutation.observe(dom, { childList: true, subtree: true })
    const resize = new ResizeObserver(scheduleReflow)
    resize.observe(dom)
    dom.addEventListener('load', scheduleReflow, true)
    editor.on('selectionUpdate', schedule)
    editor.on('transaction', schedule)
    document.fonts.ready.then(scheduleReflow)
    document.fonts.addEventListener('loadingdone', scheduleReflow)
    scheduleReflow()
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      mutation.disconnect()
      resize.disconnect()
      dom.removeEventListener('load', scheduleReflow, true)
      document.fonts.removeEventListener('loadingdone', scheduleReflow)
      editor.off('selectionUpdate', schedule)
      editor.off('transaction', schedule)
    }
  }, [editor])
  return pages
}
