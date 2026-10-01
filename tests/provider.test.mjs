import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANYSEARCH_DEFAULT_BASE_URL,
  AutoFailoverSearchProvider,
  TAVILY_DEFAULT_BASE_URL,
  apply,
} from '../index.mjs'

/**
 * Behavioural tests for the failover cascade.
 *
 * The previous suite asserted two strings inside `cordis.patch.yml`, which could
 * not have noticed that the third cascade tier never returned sources, nor that a
 * provider which returned no results was reported to the user as "no API key
 * configured". These drive the provider with a stubbed `fetch` instead.
 */

const ENV_KEYS = [
  'ANYSEARCH_API_KEY',
  'ANYSEARCH_BASE_URL',
  'TAVILY_API_KEY',
  'TAVILY_BASE_URL',
  'DEEPSEEK_API_KEY',
]

/** Run `body` with every credential env var cleared, then restore them. */
async function withoutEnv(body) {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of ENV_KEYS) delete process.env[key]
  try {
    return await body()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/** Install a fake `fetch` for the duration of `body`; `handler` may throw. */
async function withStubbedFetch(handler, body) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      init,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    const outcome = handler(call)
    if (outcome instanceof Error) throw outcome
    return outcome
  }
  try {
    return await body(calls)
  } finally {
    globalThis.fetch = original
  }
}

const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const anysearchHits = (count) =>
  jsonResponse({
    data: {
      results: Array.from({ length: count }, (_, i) => ({
        url: `https://anysearch.example/${i}`,
        title: `AnySearch ${i}`,
        snippet: `snippet ${i}`,
        published_date: '2026-08-01',
      })),
    },
  })

const tavilyHits = (count) =>
  jsonResponse({
    results: Array.from({ length: count }, (_, i) => ({
      url: `https://tavily.example/${i}`,
      title: `Tavily ${i}`,
      content: `content ${i}`,
      published_date: '2026-08-02',
    })),
  })

test('AnySearch answers without touching Tavily', async () => {
  await withStubbedFetch(() => anysearchHits(2), async (calls) => {
    const provider = new AutoFailoverSearchProvider({ anysearchKey: 'k-any', tavilyKey: 'k-tav' })
    const result = await provider.search({ query: 'hello', maxResults: 5 })

    assert.equal(result.sources.length, 2)
    assert.deepEqual(result.sources[0], {
      url: 'https://anysearch.example/0',
      title: 'AnySearch 0',
      snippet: 'snippet 0',
      publishedAt: '2026-08-01',
    })
    assert.equal(result.truncated, false)
    assert.equal(calls.length, 1, '只应该打一次请求')
    assert.ok(calls[0].url.startsWith(ANYSEARCH_DEFAULT_BASE_URL))
    assert.equal(calls[0].body.max_results, 5)
  })
})

test('a failing AnySearch falls back to Tavily', async () => {
  const handler = (call) => (call.url.startsWith(ANYSEARCH_DEFAULT_BASE_URL) ? jsonResponse({}, 429) : tavilyHits(3))
  await withStubbedFetch(handler, async (calls) => {
    const provider = new AutoFailoverSearchProvider({ anysearchKey: 'k-any', tavilyKey: 'k-tav' })
    const result = await provider.search({ query: 'hello' })

    assert.equal(calls.length, 2)
    assert.ok(calls[1].url.startsWith(TAVILY_DEFAULT_BASE_URL))
    assert.equal(result.sources.length, 3)
    assert.deepEqual(result.sources[0], {
      url: 'https://tavily.example/0',
      title: 'Tavily 0',
      snippet: 'content 0',
      publishedAt: '2026-08-02',
    })
  })
})

test('an AnySearch call that returns no results also falls back', async () => {
  const handler = (call) =>
    call.url.startsWith(ANYSEARCH_DEFAULT_BASE_URL) ? jsonResponse({ data: { results: [] } }) : tavilyHits(1)
  await withStubbedFetch(handler, async (calls) => {
    const provider = new AutoFailoverSearchProvider({ anysearchKey: 'k-any', tavilyKey: 'k-tav' })
    const result = await provider.search({ query: 'hello' })

    assert.equal(calls.length, 2)
    assert.equal(result.sources.length, 1)
  })
})

test('exhausting the cascade reports missing results, not a missing key', async () => {
  const handler = (call) =>
    call.url.startsWith(ANYSEARCH_DEFAULT_BASE_URL) ? jsonResponse({ data: { results: [] } }) : jsonResponse({ results: [] })
  await withStubbedFetch(handler, async () => {
    const provider = new AutoFailoverSearchProvider({ anysearchKey: 'k-any', tavilyKey: 'k-tav' })
    const error = await provider.search({ query: 'hello' }).then(
      () => undefined,
      (err) => err,
    )

    assert.ok(error, '两个源都没有结果时应该抛错')
    assert.match(error.message, /没有返回结果/)
    assert.match(error.message, /AnySearch: 请求成功但没有结果/)
    assert.match(error.message, /Tavily: 请求成功但没有结果/)
    assert.doesNotMatch(error.message, /未配置任何搜索 API Key/)
  })
})

test('without any key the provider says it is unavailable', async () => {
  await withoutEnv(async () => {
    const provider = new AutoFailoverSearchProvider({})
    assert.equal(provider.available(), false)

    const error = await provider.search({ query: 'hello' }).then(
      () => undefined,
      (err) => err,
    )
    assert.ok(error)
    assert.match(error.message, /未配置任何搜索 API Key/)
    assert.match(error.message, /ANYSEARCH_API_KEY/)
  })
})

test('available() reflects whether a key was supplied', async () => {
  await withoutEnv(async () => {
    assert.equal(new AutoFailoverSearchProvider({ anysearchKey: 'k' }).available(), true)
    assert.equal(new AutoFailoverSearchProvider({ tavilyKey: 'k' }).available(), true)
    assert.equal(new AutoFailoverSearchProvider({}).available(), false)
  })
})

test('DEEPSEEK_API_KEY alone no longer counts as usable', async () => {
  // The DeepSeek tier spoken a `/chat/completions` request with a `search: true`
  // parameter — DeepSeek has no such parameter, so the tier never produced
  // sources and only served to hand a chat answer back as search results.
  await withoutEnv(async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-does-not-matter'
    const provider = new AutoFailoverSearchProvider({})
    assert.equal(provider.available(), false)
    assert.equal(provider._searchDeepSeek, undefined)
  })
})

test('maxResults defaults to the configured value and is forwarded', async () => {
  await withStubbedFetch(() => anysearchHits(1), async (calls) => {
    const provider = new AutoFailoverSearchProvider({ anysearchKey: 'k', maxResults: 7 })
    await provider.search({ query: 'hello' })
    assert.equal(calls[0].body.max_results, 7)

    calls.length = 0
    await provider.search({ query: 'hello', maxResults: 2 })
    assert.equal(calls[0].body.max_results, 2)
  })
})

test('the caller cancellation signal reaches fetch', async () => {
  const controller = new AbortController()
  await withStubbedFetch(() => anysearchHits(1), async (calls) => {
    const provider = new AutoFailoverSearchProvider({ anysearchKey: 'k' })
    await provider.search({ query: 'hello' }, controller.signal)
    assert.equal(calls[0].init.signal, controller.signal)
  })
})

test('the base URLs can be overridden', async () => {
  await withStubbedFetch(() => anysearchHits(1), async (calls) => {
    const provider = new AutoFailoverSearchProvider({
      anysearchKey: 'k',
      anysearchBaseURL: 'https://anysearch.internal/v2',
    })
    await provider.search({ query: 'hello' })
    assert.ok(calls[0].url.startsWith('https://anysearch.internal/v2'))
  })
})

test('apply() registers the id the bundle patch selects', async () => {
  await withoutEnv(async () => {
    const registered = []
    const ctx = { web: { registerSearchProvider: (provider) => registered.push(provider) } }

    apply(ctx, { tavilyKey: 'k' })
    assert.equal(registered.length, 1, 'apply() 应该注册一个 provider')
    assert.equal(registered[0].id, 'anysearch', 'patch 里 searchProvider 指的就是这个 id')
    assert.equal(registered[0].available(), true)

    // Config beats the environment, and the plugin stays honest about a missing key.
    registered.length = 0
    apply(ctx, {})
    assert.equal(registered[0].available(), false)
  })
})
