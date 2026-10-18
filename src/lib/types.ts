import type { JSONContent } from '@tiptap/react'

export interface DocumentLayout {
  pageSize: 'A4' | 'A5' | 'Letter'
  orientation: 'portrait' | 'landscape'
  margins: { top: number; right: number; bottom: number; left: number }
  lineSpacing: number
  paragraphBefore: number
  paragraphAfter: number
}

export interface StoredDocument {
  id: string
  title: string
  content: JSONContent
  updatedAt: string
  layout?: DocumentLayout
}

export interface WorkspaceState {
  version: 1
  activeId: string | null
  documents: StoredDocument[]
}

export interface JScriptBridge {
  openFile(): Promise<{ name: string; data: number[] } | null>
  saveFile(file: { name: string; data: number[] }): Promise<string | null>
  loadAutosave(): Promise<unknown>
  saveAutosave(state: WorkspaceState): Promise<void>
  exportPdf(document: { title: string; html: string; layout?: DocumentLayout }): Promise<string | null>
  printDocument(document: { title: string; html: string; layout?: DocumentLayout }): Promise<void>
  setDirty(dirty: boolean): void
}

declare global {
  interface Window {
    jscript?: JScriptBridge
  }
}
