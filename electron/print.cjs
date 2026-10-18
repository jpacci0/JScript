'use strict';

const { BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const sanitizeHtml = require('sanitize-html');
const { normalizeLayout, pageDimensions } = require('./layout.cjs');

const MAX_HTML_BYTES = 40 * 1024 * 1024;
const COLOR = /^(?:#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z]{1,24})$/i;
const LENGTH = /^\d{1,4}(?:\.\d+)?(?:px|pt|em|rem|%)$/;
const IMAGE_DATA = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z\d+/=\s]+$/i;

function escapeText(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function documentHtml(document) {
  if (!document || typeof document.html !== 'string' || typeof document.title !== 'string') {
    throw new Error('Documento da stampare non valido.');
  }
  if (Buffer.byteLength(document.html, 'utf8') > MAX_HTML_BYTES || document.title.length > 500) {
    throw new Error('Il documento supera il limite di stampa di 40 MB.');
  }
  const layout = normalizeLayout(document.layout);
  const dimensions = pageDimensions(layout);

  // Sanitization is independent of the editor. Documents never get scripts,
  // embedded frames, SVG, remote images, or arbitrary CSS in the print process.
  const content = sanitizeHtml(document.html, {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'sub', 'sup',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre',
      'code', 'hr', 'span', 'div', 'a', 'mark', 'img', 'table', 'thead', 'tbody',
      'tfoot', 'tr', 'td', 'th', 'colgroup', 'col', 'caption',
    ],
    allowedAttributes: {
      '*': ['style'],
      div: ['class'],
      img: ['src', 'alt', 'width', 'height'],
      ol: ['start'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      col: ['width', 'span'],
      table: ['data-jscript-layout'],
    },
    allowedClasses: { div: ['page-break'] },
    allowedSchemes: ['data'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    allowedStyles: {
      table: {
        '--jscript-column-left': [/^(?:\d{1,2}(?:\.\d+)?|100)%$/],
        '--jscript-column-right': [/^(?:\d{1,2}(?:\.\d+)?|100)%$/],
      },
      '*': {
        color: [COLOR],
        'background-color': [COLOR],
        'text-align': [/^(left|right|center|justify)$/],
        'font-family': [/^[a-z\d\s,'"-]{1,120}$/i],
        'font-size': [LENGTH],
        'font-weight': [/^(normal|bold|[1-9]00)$/],
        'font-style': [/^(normal|italic)$/],
        'text-decoration': [/^(none|underline|line-through|underline line-through)$/],
        'line-height': [/^(?:\d(?:\.\d{1,2})?|\d{1,3}%)$/],
        width: [LENGTH],
        height: [LENGTH],
        'min-width': [LENGTH],
        'margin-left': [LENGTH],
        'page-break-before': [/^(always|auto)$/],
        'page-break-after': [/^(always|auto)$/],
        'break-before': [/^(page|auto)$/],
        'break-after': [/^(page|auto)$/],
      },
    },
    transformTags: {
      table: (tagName, attributes) => {
        const attribs = { ...attributes };
        if (attribs['data-jscript-layout'] !== 'columns') {
          delete attribs['data-jscript-layout'];
        } else {
          // TablePlus serializes widths as metadata, not <colgroup>. Rebuild only
          // numeric CSS values here before the untrusted attributes are stripped.
          const raw = attribs['data-column-size'];
          const parts = typeof raw === 'string' && raw.length <= 2000 ? raw.split(',').map(value => value.trim()) : [];
          const valid = parts.length === 2 && parts.every(value => /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && Number(value) > 0 && Number(value) <= 100);
          const values = valid ? parts.map(Number) : [50, 50];
          const total = values[0] + values[1];
          const left = Math.round(values[0] / total * 100000000) / 1000000;
          const right = Math.round(values[1] / total * 100000000) / 1000000;
          attribs.style = `${attribs.style || ''};--jscript-column-left:${left}%;--jscript-column-right:${right}%`;
        }
        return { tagName, attribs };
      },
      img: (tagName, attributes) => ({
        tagName,
        attribs: IMAGE_DATA.test(attributes.src || '')
          ? attributes
          : { alt: attributes.alt || '' },
      }),
      div: (tagName, attributes) => ({
        tagName,
        attribs: attributes['data-type'] === 'page-break'
          ? { class: 'page-break' }
          : attributes,
      }),
    },
  });

  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeText(document.title)}</title><style>
@page { size: ${dimensions.width}mm ${dimensions.height}mm; margin: ${layout.margins.top}mm ${layout.margins.right}mm ${layout.margins.bottom}mm ${layout.margins.left}mm; }
* { box-sizing: border-box; }
html { background: white; }
body { margin: 0; color: #20212b; font: 12pt/${layout.lineSpacing} 'Segoe UI', Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; overflow-wrap: break-word; }
p { margin: ${layout.paragraphBefore}pt 0 ${layout.paragraphAfter}pt; min-height: 1em; orphans: 3; widows: 3; }
p:empty::before { content: '\\00a0'; }
h1, h2, h3, h4, h5, h6 { color: #20212b; line-height: 1.2; break-after: avoid; margin: 1em 0 .45em; }
h1 { font-size: 28pt; } h2 { font-size: 19pt; } h3 { font-size: 14pt; }
ul, ol { padding-left: 1.6em; }
blockquote { margin: 1em 0; padding: .3em 1em; border-left: 3px solid #b5a4e5; color: #5d576a; }
pre { background: #f5f4f7; border-radius: 6px; padding: 1em; white-space: pre-wrap; }
code { font-family: Consolas, monospace; font-size: .9em; }
img { max-width: 100%; height: auto; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 1em 0; }
td, th { border: 1px solid #d7d4df; padding: 8px 10px; vertical-align: top; min-width: 1em; }
th { background: #f4f1fa; font-weight: 600; text-align: left; }
tr { break-inside: avoid; } thead { display: table-header-group; }
table[data-jscript-layout="columns"] { border: 0; margin: 0; break-inside: auto; }
table[data-jscript-layout="columns"] > :is(thead, tbody, tfoot) > tr { break-inside: auto; }
table[data-jscript-layout="columns"] > :is(thead, tbody, tfoot) > tr > :is(td, th) { border: 0; padding: 0; background: transparent; font-weight: inherit; }
table[data-jscript-layout="columns"] > :is(thead, tbody, tfoot) > tr > :is(td, th):first-child { width: var(--jscript-column-left, 50%); padding-right: 4mm; }
table[data-jscript-layout="columns"] > :is(thead, tbody, tfoot) > tr > :is(td, th):last-child { width: var(--jscript-column-right, 50%); padding-left: 4mm; }
hr { border: 0; border-top: 1px solid #d7d4df; margin: 1.5em 0; }
a { color: #7756b7; text-decoration: underline; }
.page-break { break-after: page; height: 0; }
</style></head><body>${content}</body></html>`;
}

async function withPrintWindow(document, temporaryRoot, callback) {
  const html = documentHtml(document);
  const directory = await fs.mkdtemp(path.join(temporaryRoot, 'jscript-print-'));
  const filename = path.join(directory, 'document.html');
  let window;
  try {
    await fs.writeFile(filename, html, { encoding: 'utf8', mode: 0o600 });
    window = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        partition: `jscript-print-${randomUUID()}`,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        javascript: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
      },
    });
    const printSession = window.webContents.session;
    const allowedFile = pathToFileURL(filename).href;
    printSession.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
    printSession.setPermissionCheckHandler(() => false);
    printSession.webRequest.onBeforeRequest((details, reply) => {
      reply({ cancel: details.url !== allowedFile && !details.url.startsWith('data:image/') });
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    await window.loadFile(filename);
    return await callback(window.webContents);
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    await fs.rm(filename, { force: true });
    await fs.rmdir(directory);
  }
}

module.exports = { withPrintWindow, documentHtml };
