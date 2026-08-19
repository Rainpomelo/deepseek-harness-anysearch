export const name = "web-search-anysearch";
export const inject = ["web"];

export const ANYSEARCH_DEFAULT_BASE_URL = "https://api.anysearch.com/v1";
export const TAVILY_DEFAULT_BASE_URL = "https://api.tavily.com";

/**
 * Multi-provider Search Driver with Automatic Failover (Auto-Pool)
 * Automatically cascades: AnySearch -> Tavily -> DeepSeek Official
 */
export class AutoFailoverSearchProvider {
  constructor(options) {
    this.id = options.id || "anysearch";
    this.options = options || {};
  }

  available() {
    return true;
  }

  async search(request, signal) {
    const numResults = request.maxResults || this.options.maxResults || 5;
    const errors = [];

    // Candidate 1: AnySearch
    const anysearchKey = this.options.anysearchKey || process.env.ANYSEARCH_API_KEY || "REDACTED-REVOKED-KEY";
    if (anysearchKey) {
      try {
        const res = await this._searchAnySearch(request.query, numResults, anysearchKey, signal);
        if (res && res.sources && res.sources.length > 0) return res;
      } catch (err) {
        errors.push("AnySearch failed: " + (err.message || String(err)));
      }
    }

    // Candidate 2: Tavily
    const tavilyKey = this.options.tavilyKey || process.env.TAVILY_API_KEY || "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";
    if (tavilyKey) {
      try {
        const res = await this._searchTavily(request.query, numResults, tavilyKey, signal);
        if (res && res.sources && res.sources.length > 0) return res;
      } catch (err) {
        errors.push("Tavily failed: " + (err.message || String(err)));
      }
    }

    // Candidate 3: DeepSeek Official
    const deepseekKey = this.options.deepseekKey || process.env.DEEPSEEK_API_KEY;
    if (deepseekKey) {
      try {
        const res = await this._searchDeepSeek(request.query, numResults, deepseekKey, signal);
        if (res && res.sources && res.sources.length > 0) return res;
      } catch (err) {
        errors.push("DeepSeek failed: " + (err.message || String(err)));
      }
    }

    throw new Error("All search providers failed in auto-failover pool:\n" + errors.join("\n"));
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
      throw new Error("HTTP " + response.status + " " + errText);
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
      throw new Error("HTTP " + response.status + " " + errText);
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
      throw new Error("HTTP " + response.status + " " + errText);
    }

    const payload = await response.json();
    return {
      sources: [],
      content: payload.choices?.[0]?.message?.content || "",
      truncated: false,
    };
  }
}

export function apply(ctx, config) {
  const provider = new AutoFailoverSearchProvider({
    id: "anysearch",
    anysearchKey: (config && config.apiKey) || (config && config.anysearchKey) || process.env.ANYSEARCH_API_KEY || "REDACTED-REVOKED-KEY",
    tavilyKey: (config && config.tavilyKey) || process.env.TAVILY_API_KEY || "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",
    deepseekKey: (config && config.deepseekKey) || process.env.DEEPSEEK_API_KEY,
    maxResults: (config && config.maxResults) || 5,
  });

  ctx.web.registerSearchProvider(provider);
}
