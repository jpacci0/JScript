import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const { isAllowedPrintRequest } = createRequire(import.meta.url)('../electron/print.cjs') as {
  isAllowedPrintRequest(requestURL: string, allowedFile: string): boolean
}

test('print requests accept Chromium tilde normalization without allowing other files or network access', () => {
  const filename = path.resolve('RUNNER~1', 'print document', 'document.html')
  const allowed = pathToFileURL(filename).href
  assert.equal(isAllowedPrintRequest(allowed, allowed), true)
  assert.equal(isAllowedPrintRequest(allowed.replace(/%7E/gi, '~'), allowed), true)
  assert.equal(isAllowedPrintRequest('data:image/png;base64,AA==', allowed), true)
  for (const request of [
    pathToFileURL(path.resolve('RUNNER~1', 'print document', 'other.html')).href,
    allowed + '?other', allowed + '#other', allowed.replace('document.html', '%2Fdocument.html'),
    'https://example.com/document.html', 'file://example.com/document.html',
    'data:text/html,test', 'javascript:alert(1)', 'not a URL',
  ]) {
    assert.equal(isAllowedPrintRequest(request, allowed), false, request)
  }
})
