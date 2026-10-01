import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { inject, name } from '../index.mjs'

/**
 * The bundle patch is the contract between this repository and the profile that
 * loads it: the row id selects the module, and the two provider ids have to name
 * providers that are actually registered, or the seam throws
 * `WEB_PROVIDER_CONFIGURED_MISSING` at search time.
 */
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

test('the patch inserts the row this module exports', () => {
  // The row id is the key cordis resolves the module by, so renaming the module
  // without renaming the row would silently orphan it.
  assert.match(patch, new RegExp(`id:\\s*${name}\\b`))
  assert.match(patch, /name:\s*dsh-web-search-anysearch\b/)
})

test('the patch selects this provider for search', () => {
  assert.match(patch, /searchProvider:\s*anysearch\b/)
})

test('the patch names the fetch provider the host registers', () => {
  // `http` is `LOCAL_FETCH_PROVIDER_ID` in the shipped
  // `@deepseek-ai/dsh-web-fetch-http`. DSH 0.2.0-rc.2's base bundle already
  // configures it, so this line is explicit rather than required — but it must
  // never name something else, and it must never send anyone off to install that
  // package a second time (a duplicate row id is what the plugin list flags).
  assert.match(patch, /fetchProvider:\s*http\b/)
})

test('the plugin injects only services both installations publish', () => {
  // A static inject naming a service the host never provides leaves the plugin
  // permanently pending, with no error to read.
  assert.deepEqual(inject, ['web'])
})
