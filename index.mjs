export const name = "web-search-anysearch";
export const inject = ["web"];

export const ANYSEARCH_DEFAULT_BASE_URL = "https://api.anysearch.com/v1";
export const ANYSEARCH_PROVIDER_ID = "anysearch";

export class AnySearchSearchProvider {
  constructor(options) {
    this.id = ANYSEARCH_PROVIDER_ID;
    this.options = options || {};
  }

  available() {
    return Boolean(this.options.apiKey && this.options.apiKey.trim().length > 0);
  }

  async search(request, signal) {
    const numResults = request.maxResults || this.options.maxResults || 5;
    const baseURL = this.options.baseURL || ANYSEARCH_DEFAULT_BASE_URL;
    const url = baseURL + "/search";

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": "Bearer " + this.options.apiKey,
        },
        body: JSON.stringify({
          query: request.query,
          max_results: numResults,
        }),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error("AnySearch search aborted");
      }
      throw new Error("AnySearch request failed: " + (error ? error.message : String(error)));
    }

    if (!response.ok) {
      throw new Error("AnySearch API error (HTTP " + response.status + ")");
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
}

export function apply(ctx, config) {
  const apiKey = (config && config.apiKey) || process.env.ANYSEARCH_API_KEY || "REDACTED-REVOKED-KEY";
  const baseURL = (config && config.baseURL) || ANYSEARCH_DEFAULT_BASE_URL;

  ctx.web.registerSearchProvider(
    new AnySearchSearchProvider({
      apiKey,
      baseURL,
      maxResults: (config && config.maxResults) || 5,
    })
  );
}
