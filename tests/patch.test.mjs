import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('uses the registered HTTP fetch provider when enabled', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /searchProvider:\s*anysearch/)
  assert.match(patch, /fetchProvider:\s*http/)
})
