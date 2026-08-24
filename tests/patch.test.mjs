import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('does not require an unbundled HTTP fetch provider', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /searchProvider:\s*anysearch/)
  assert.doesNotMatch(patch, /fetchProvider:\s*http/)
})
