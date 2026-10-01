export const name = "web-search-anysearch";
export const inject = ["web"];

export const ANYSEARCH_DEFAULT_BASE_URL = "https://api.anysearch.com/v1";
export const TAVILY_DEFAULT_BASE_URL = "https://api.tavily.com";

/**
 * 带有自动容灾级联的多源网页搜索驱动 (Auto Failover Search Provider)
 * 级联顺序: AnySearch -> Tavily
 *
 * 这里**故意不做** DeepSeek 兜底：DeepSeek 的联网检索不是
 * `chat/completions` 上一个 `search: true` 参数，而是 Anthropic 格式的
 * `/messages` 端点 + `web_search_20250305` 服务器工具（见 DSH 自带的
 * `@deepseek-ai/dsh-web-search-deepseek`，它在没有 `web_search_tool_result`
 * 块时会主动报错，而不是把模型的一段回答当成检索结果）。之前那层兜底永远
 * 拿不到 sources，却把聊天回复当搜索结果返回——需要 DeepSeek 检索的用户把
 * `web.searchProvider` 指回 `deepseek-official` 即可。
 */
export class AutoFailoverSearchProvider {
  constructor(options = {}) {
    this.id = options.id || "anysearch";
    this.options = options;
  }

  /**
   * 搜索能力是否需要凭据：seam 在选中 provider 前会问这一句（见
   * `@deepseek-ai/dsh-web` 的 `resolveProvider`）。有凭据的 provider 必须
   * 如实回答——配了 `searchProvider: anysearch` 却没有 Key 时谎报可用，只会
   * 让每次搜索都变成一个专属报错，而不是 seam 的
   * `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`。
   */
  available() {
    return Boolean(this.options.anysearchKey || this.options.tavilyKey);
  }

  async search(request, signal) {
    const numResults = request.maxResults || this.options.maxResults || 5;
    const anysearchKey = this.options.anysearchKey || process.env.ANYSEARCH_API_KEY;
    const tavilyKey = this.options.tavilyKey || process.env.TAVILY_API_KEY;

    if (!anysearchKey && !tavilyKey) {
      throw new Error("未配置任何搜索 API Key：请设置 ANYSEARCH_API_KEY，或在插件配置里提供 apiKey");
    }

    // 记录每个搜索源到底发生了什么。"没配 Key"、"请求失败"、"请求成功但零结果"
    // 是三种不同的事，之前它们都会被归结成一句"未配置有效的搜索 API Key"。
    const notes = [];

    if (anysearchKey) {
      const hit = await this._attempt(
        () => this._searchAnySearch(request.query, numResults, anysearchKey, signal),
        "AnySearch",
        notes,
        request.query,
      );
      if (hit) return hit;
    } else {
      notes.push("AnySearch: 未配置 API Key");
    }

    if (tavilyKey) {
      const hit = await this._attempt(
        () => this._searchTavily(request.query, numResults, tavilyKey, signal),
        "Tavily",
        notes,
        request.query,
      );
      if (hit) return hit;
    } else {
      notes.push("Tavily: 未配置 API Key");
    }

    throw new Error("所有已配置的搜索源都没有返回结果:\n" + notes.join("\n"));
  }

  /**
   * 跑一个搜索源：成功且有结果就返回它，否则记录原因后返回 undefined，
   * 由调用方决定是否降级到下一个源。
   * @param run - 发起请求的惰性函数。
   * @param label - 日志与错误里的来源名。
   * @param notes - 追加本次结果的数组。
   * @param query - 用于日志的关键词。
   * @returns 有结果时返回该结果，否则 undefined。
   */
  async _attempt(run, label, notes, query) {
    try {
      const res = await run();
      if (res && res.sources && res.sources.length > 0) {
        console.log(`[dsh-web-search] ${label} 返回结果 (${res.sources.length} 条) | 关键词: "${query}"`);
        return res;
      }
      notes.push(`${label}: 请求成功但没有结果`);
    } catch (err) {
      notes.push(`${label}: ${err.message || String(err)}`);
      console.warn(`[dsh-web-search] ${label} 请求异常，降级到下一个源: ${err.message || err}`);
    }
    return undefined;
  }

  async _searchAnySearch(query, maxResults, apiKey, signal) {
    const baseURL = this.options.anysearchBaseURL || ANYSEARCH_DEFAULT_BASE_URL;
    const url = baseURL + "/search";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + apiKey,
      },
      body: JSON.stringify({
        query: query,
        max_results: maxResults,
      }),
      ...(signal !== undefined ? { signal } : {}),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${errText}`);
    }

    const payload = await response.json();
    const results = (payload && payload.data && payload.data.results) || (payload && payload.results) || [];
    const sources = results.map((r) => ({
      url: r.url || "",
      title: r.title || "",
      snippet: r.snippet || r.content || "",
      ...(r.published_date || r.publishedAt ? { publishedAt: r.published_date || r.publishedAt } : {}),
    }));

    return {
      sources,
      ...(payload && payload.data && payload.data.answer ? { content: payload.data.answer } : {}),
      truncated: false,
    };
  }

  async _searchTavily(query, maxResults, apiKey, signal) {
    const baseURL = this.options.tavilyBaseURL || TAVILY_DEFAULT_BASE_URL;
    const url = baseURL + "/search";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        max_results: maxResults,
        search_depth: "basic",
      }),
      ...(signal !== undefined ? { signal } : {}),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${errText}`);
    }

    const payload = await response.json();
    const results = (payload && payload.results) || [];
    const sources = results.map((r) => ({
      url: r.url || "",
      title: r.title || "",
      snippet: r.content || "",
      ...(r.published_date ? { publishedAt: r.published_date } : {}),
    }));

    return {
      sources,
      ...(payload && payload.answer ? { content: payload.answer } : {}),
      truncated: false,
    };
  }
}

export function apply(ctx, config = {}) {
  const provider = new AutoFailoverSearchProvider({
    id: "anysearch",
    anysearchKey: config.apiKey || config.anysearchKey || process.env.ANYSEARCH_API_KEY,
    anysearchBaseURL: config.baseURL || config.anysearchBaseURL || process.env.ANYSEARCH_BASE_URL,
    tavilyKey: config.tavilyKey || process.env.TAVILY_API_KEY,
    tavilyBaseURL: config.tavilyBaseURL || process.env.TAVILY_BASE_URL,
    maxResults: config.maxResults || 5,
  });

  ctx.web.registerSearchProvider(provider);
}
