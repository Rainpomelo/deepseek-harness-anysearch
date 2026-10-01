# dsh-web-search-anysearch

DeepSeek Harness (DSH) 的多源级联网页搜索插件。

当 Agent 触发网页检索时，本插件按优先级依次尝试可用的搜索源；首选源请求超时、限流、报错**或返回零结果**时，自动降级到备用源，避免单点故障导致搜索中断。

---

## 级联顺序

1. **AnySearch**（首选）
   - 使用 AnySearch Search API 获取结构化检索结果。
2. **Tavily**（备用源）
   - AnySearch 未配置、报错或零结果时自动切换。

### 为什么没有 DeepSeek 兜底

早期版本有第三层「DeepSeek 官方搜索」，**已移除**——它实现错了：它往 `https://api.deepseek.com/chat/completions` 发一个 `search: true` 参数，而 DeepSeek 的联网检索并不是聊天接口上的参数，而是 Anthropic 格式的 `/messages` 端点 + `web_search_20250305` 服务器工具。结果是那一层**永远拿不到 `sources`**，却把模型的一段聊天回复当作搜索结果返回。

如果你想要 DeepSeek 检索，DSH 自带正确的实现，把 `web.searchProvider` 指回 `deepseek-official` 即可：

```yaml
- id: web
  config:
    searchProvider: deepseek-official
```

---

## 安装与接入

在 profile 的 `package.json` 里加依赖，并在 `dsh.profile.bundles` 里登记（用 `dsh plugin add` 或桌面端「添加插件」都会自动完成这两步）：

```jsonc
{
  "dependencies": {
    "dsh-web-search-anysearch": "github:Rainpomelo/dsh-anysearch"
  },
  "dsh": { "profile": { "bundles": ["dsh-web-search-anysearch"] } }
}
```

然后确认 patch 生效：
```yaml
- insert:
    - id: web-search-anysearch
      name: dsh-web-search-anysearch

- id: web
  config:
    searchProvider: anysearch
    fetchProvider: http
```

> **不需要**另外安装 `@deepseek-ai/dsh-web-fetch-http`。DSH 0.2.0-rc.2 的基础包已经自带它，且注册的 id 就是 `http`。
> 如果你此前按旧版本文档手动装过一份（`file:` 指向本地目录），**请卸掉**：它的 patch 会再 `insert` 一次同一个 id `web-fetch-http`，与基础包冲突，插件列表会把那一条标成「异常」。

---

## 配置参数

API Key 可以通过插件配置或环境变量提供，两者都行。

### 方式 A：在 profile 的 patch 里配置

```yaml
- id: web-search-anysearch
  config:
    apiKey: "as_sk_your_anysearch_key"     # AnySearch API Key
    tavilyKey: "tvly-your_tavily_key"      # 可选：Tavily 备用 Key
    maxResults: 5                          # 单次搜索返回条数（默认 5）
```

### 方式 B：使用环境变量

| 环境变量 | 说明 |
| :--- | :--- |
| `ANYSEARCH_API_KEY` | AnySearch 的认证密钥 |
| `ANYSEARCH_BASE_URL` | 自定义 AnySearch 接口地址（默认 `https://api.anysearch.com/v1`） |
| `TAVILY_API_KEY` | Tavily API Key |
| `TAVILY_BASE_URL` | 自定义 Tavily 接口地址（默认 `https://api.tavily.com`） |

两个 Key 至少要有一个，否则 `available()` 会返回 `false`，seam 会以
`WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 拒绝这次搜索——这是刻意的：有凭据的 provider
谎报可用，只会让每次搜索都变成一个专属报错。

---

## 运行日志说明

插件在后台运行时会通过标准控制台输出当前命中的搜索源：

- `[dsh-web-search] AnySearch 返回结果 (5 条) | 关键词: "..."`
- `[dsh-web-search] Tavily 返回结果 (5 条) | 关键词: "..."`
- `[dsh-web-search] AnySearch 请求异常，降级到下一个源: HTTP 429 ...`

当所有源都没结果时，抛出的错误会逐条说明每个源到底发生了什么
（`未配置 API Key` / `请求成功但没有结果` / 具体报错），而不是笼统地说一句
「未配置有效的搜索 API Key」。

---

## 开发

```sh
node --test tests/*.test.mjs
```

`tests/patch.test.mjs` 检查 bundle patch 与模块导出的 id 是否仍然一致；
`tests/provider.test.mjs` 用打桩的 `fetch` 驱动级联逻辑（降级、零结果、Key 缺失、
`maxResults` 透传、取消信号透传等）。

---

## License

MIT
