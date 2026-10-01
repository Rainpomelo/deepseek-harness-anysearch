import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * An early revision shipped the author's real AnySearch key as a hardcoded
 * fallback default (`|| "as_sk_…"`) in `index.mjs`, and those commits are still
 * reachable in this public repository's history. Removing it from the working
 * tree does not undo that, but nothing tracked may carry a credential again.
 *
 * The pattern requires a long unbroken alphanumeric tail, so documentation
 * placeholders such as `as_sk_your_anysearch_key` do not trip it.
 */
const CREDENTIAL = /as_sk_[A-Za-z0-9]{20,}|tvly-[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{32,}/g

const root = fileURLToPath(new URL('..', import.meta.url))

/** Every file under the repository except the ones that are never published. */
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    const rel = relative(root, path)
    if (rel === '.git' || rel.startsWith(`.git${sep}`)) continue
    if (rel === 'node_modules' || rel.startsWith(`node_modules${sep}`)) continue
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}

test('no tracked file carries a credential', async () => {
  const offenders = []
  for await (const file of walk(root)) {
    const text = await readFile(file, 'utf8').catch(() => '')
    for (const match of text.matchAll(CREDENTIAL)) {
      offenders.push(`${relative(root, file)}: ${match[0].slice(0, 10)}…(${match[0].length})`)
    }
  }
  assert.deepEqual(offenders, [], '仓库里不允许出现明文密钥')
})
