'use strict';

const PAGE_DIMENSIONS = Object.freeze({
  A4: Object.freeze({ width: 210, height: 297 }),
  A5: Object.freeze({ width: 148, height: 210 }),
  Letter: Object.freeze({ width: 215.9, height: 279.4 }),
});

function boundedNumber(value, fallback, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(maximum, Math.max(minimum, value)) * 100) / 100;
}

function normalizeLayout(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const margins = input.margins && typeof input.margins === 'object' && !Array.isArray(input.margins)
    ? input.margins : {};
  return {
    pageSize: typeof input.pageSize === 'string' && Object.hasOwn(PAGE_DIMENSIONS, input.pageSize)
      ? input.pageSize : 'A4',
    orientation: input.orientation === 'landscape' ? 'landscape' : 'portrait',
    margins: {
      top: boundedNumber(margins.top, 20, 5, 50),
      right: boundedNumber(margins.right, 20, 5, 50),
      bottom: boundedNumber(margins.bottom, 20, 5, 50),
      left: boundedNumber(margins.left, 20, 5, 50),
    },
    lineSpacing: boundedNumber(input.lineSpacing, 1.7, 1, 3),
    paragraphBefore: boundedNumber(input.paragraphBefore, 0, 0, 48),
    paragraphAfter: boundedNumber(input.paragraphAfter, 10.8, 0, 48),
  };
}

function pageDimensions(value) {
  const layout = normalizeLayout(value);
  const size = PAGE_DIMENSIONS[layout.pageSize];
  return layout.orientation === 'landscape'
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

module.exports = { normalizeLayout, pageDimensions };
