export const name = "web-search-anysearch";
export const inject = ["web"];

export const ANYSEARCH_DEFAULT_BASE_URL = "https://api.anysearch.com/v1";
export const TAVILY_DEFAULT_BASE_URL = "https://api.tavily.com";

/**
 * 带有自动容灾级联的多源网页搜索驱动 (Auto Failover Search Provider)
 * 级联顺序: AnySearch -> Tavily -> DeepSeek Official Web Search
 */
export class AutoFailoverSearchProvider {
  constructor(options = {}) {
    this.id = options.id || "anysearch";
    this.options = options;
  }

  available() {
    return true;
  }

  async search(request, signal) {
    const numResults = request.maxResults || this.options.maxResults || 5;
    const errors = [];

    // 1. AnySearch 搜索源
    const anysearchKey = this.options.anysearchKey || process.env.ANYSEARCH_API_KEY;
    if (anysearchKey) {
      try {
        const res = await this._searchAnySearch(request.query, numResults, anysearchKey, signal);
        if (res && res.sources && res.sources.length > 0) {
          console.log(`[dsh-web-search] AnySearch 返回结果 (${res.sources.length} 条) | 关键词: "${request.query}"`);
          return res;
        }
      } catch (err) {
        console.warn(`[dsh-web-search] AnySearch 请求异常，尝试降级到 Tavily: ${err.message || err}`);
        errors.push("AnySearch: " + (err.message || String(err)));
      }
    }

    // 2. Tavily 搜索源 (备用降级)
    const tavilyKey = this.options.tavilyKey || process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      try {
        const res = await this._searchTavily(request.query, numResults, tavilyKey, signal);
        if (res && res.sources && res.sources.length > 0) {
          console.log(`[dsh-web-search] Tavily 备用源返回结果 (${res.sources.length} 条) | 关键词: "${request.query}"`);
          return res;
        }
      } catch (err) {
        console.warn(`[dsh-web-search] Tavily 请求异常，尝试降级到 DeepSeek: ${err.message || err}`);
        errors.push("Tavily: " + (err.message || String(err)));
      }
    }

    // 3. DeepSeek 官方搜索源 (最终兜底)
    const deepseekKey = this.options.deepseekKey || process.env.DEEPSEEK_API_KEY;
    if (deepseekKey) {
      try {
        const res = await this._searchDeepSeek(request.query, numResults, deepseekKey, signal);
        if (res) {
          console.log(`[dsh-web-search] DeepSeek 官方搜索返回结果 | 关键词: "${request.query}"`);
          return res;
        }
      } catch (err) {
        errors.push("DeepSeek: " + (err.message || String(err)));
      }
    }

    if (errors.length === 0) {
      throw new Error("未配置有效的搜索 API Key (请设置 ANYSEARCH_API_KEY 或在插件配置中传入 apiKey)");
    }

    throw new Error("所有搜索源均未能获取结果:\n" + errors.join("\n"));
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

  async _searchDeepSeek(query, maxResults, apiKey, signal) {
    const url = "https://api.deepseek.com/chat/completions";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: query }],
        search: true,
      }),
      ...(signal !== undefined ? { signal } : {}),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${errText}`);
    }

    const payload = await response.json();
    return {
      sources: [],
      content: payload.choices?.[0]?.message?.content || "",
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
    deepseekKey: config.deepseekKey || process.env.DEEPSEEK_API_KEY,
    maxResults: config.maxResults || 5,
  });

  ctx.web.registerSearchProvider(provider);
}
