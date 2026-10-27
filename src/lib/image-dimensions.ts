import Image from '@tiptap/extension-image'
import { mergeAttributes } from '@tiptap/core'

function dimension(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d{1,4})?$/.test(value))) return null
  const result = Number(value)
  return Number.isFinite(result) && result >= 1 && result <= 10000 ? result : null
}

/** Keep Word's authored image ratio when responsive CSS makes height automatic. */
export const ImageWithDimensions = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: element => dimension(element.getAttribute('width')) },
      height: { default: null, parseHTML: element => dimension(element.getAttribute('height')) },
    }
  },
  renderHTML({ HTMLAttributes }) {
    const attributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)
    const width = dimension(attributes.width)
    const height = dimension(attributes.height)
    if (width !== null) attributes.width = width
    else delete attributes.width
    if (height !== null) attributes.height = height
    else delete attributes.height
    return ['img', width !== null && height !== null
      ? mergeAttributes(attributes, { style: `aspect-ratio: ${width} / ${height}; object-fit: fill` })
      : attributes]
  },
})
