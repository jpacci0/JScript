import type { DocumentLayout } from './types'

export type { DocumentLayout } from './types'

export const DEFAULT_LAYOUT: DocumentLayout = Object.freeze({
  pageSize: 'A4',
  orientation: 'portrait',
  margins: Object.freeze({ top: 20, right: 20, bottom: 20, left: 20 }),
  lineSpacing: 1.7,
  paragraphBefore: 0,
  paragraphAfter: 10.8,
})

const PAPER_SIZES = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
} as const

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(min, Math.min(max, value)) * 100) / 100
    : fallback
}

/** Accept old/missing settings and rebuild only the supported, bounded fields. */
export function normalizeLayout(value: unknown): DocumentLayout {
  const source = record(value)
  const margins = record(source.margins)
  return {
    pageSize: source.pageSize === 'A5' || source.pageSize === 'Letter' ? source.pageSize : 'A4',
    orientation: source.orientation === 'landscape' ? 'landscape' : 'portrait',
    margins: {
      top: number(margins.top, 20, 5, 50),
      right: number(margins.right, 20, 5, 50),
      bottom: number(margins.bottom, 20, 5, 50),
      left: number(margins.left, 20, 5, 50),
    },
    lineSpacing: number(source.lineSpacing, 1.7, 1, 3),
    paragraphBefore: number(source.paragraphBefore, 0, 0, 48),
    paragraphAfter: number(source.paragraphAfter, 10.8, 0, 48),
  }
}

/** Physical page dimensions, including orientation, in millimetres. */
export function pageDimensions(value: DocumentLayout): { width: number; height: number } {
  const layout = normalizeLayout(value)
  const size = PAPER_SIZES[layout.pageSize]
  return layout.orientation === 'landscape'
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height }
}
