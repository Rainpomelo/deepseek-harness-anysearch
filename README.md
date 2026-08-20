# dsh-web-search-anysearch

DeepSeek Harness (DSH) 的多源级联网页搜索插件。

当 Agent 在对话中触发网页检索时，本插件按照预设的优先级顺序依次尝试可用搜索源。如果首选源请求超时、限流或无结果，会自动降级尝试备用搜索源，避免单点故障导致 Agent 搜索中断。

---

## 级联顺序

1. **AnySearch**（首选）
   - 使用 AnySearch Search API 提取网页正文与结构化检索源。
2. **Tavily**（备用源 1）
   - 当 AnySearch 失败或未配置时自动切换。
3. **DeepSeek Official Search**（最终兜底）
   - 走 DeepSeek 官方接口附带的联网检索能力。

---

## 安装与接入

### 1. 放置插件目录
将本插件放置于 DSH 的插件工作区目录（例如 `C:\Agent code\deepseek-harness-插件\deepseek-harness-anysearch`）。

### 2. 在 DSH 中加载插件
在 DSH 的配置清单（`cordis.yml` 或 `cordis.patch.yml`）中引入：

```yaml
- insert:
    - id: web-search-anysearch
      name: dsh-web-search-anysearch

- id: web
  config:
    searchProvider: anysearch
    fetchProvider: http
```

---

## 配置参数

你可以通过插件的配置项（`cordis.yml`）或系统环境变量提供 API Key。

### 方式 A：在 cordis.yml 中配置

```yaml
- id: web-search-anysearch
  config:
    apiKey: "as_sk_your_anysearch_key"         # AnySearch API Key
    tavilyKey: "tvly-your_tavily_key"          # 可选：Tavily 备用 Key
    deepseekKey: "sk-your_deepseek_key"        # 可选：DeepSeek 兜底 Key
    maxResults: 5                              # 单次搜索返回条数（默认 5）
```

### 方式 B：使用环境变量

| 环境变量 | 说明 |
| :--- | :--- |
| `ANYSEARCH_API_KEY` | AnySearch 的认证密钥 |
| `ANYSEARCH_BASE_URL` | 自定义 AnySearch 接口地址（默认 `https://api.anysearch.com/v1`） |
| `TAVILY_API_KEY` | Tavily API Key |
| `TAVILY_BASE_URL` | 自定义 Tavily 接口地址（默认 `https://api.tavily.com`） |
| `DEEPSEEK_API_KEY` | DeepSeek 官方 API Key |

---

## 运行日志说明

插件在后台运行时会通过标准控制台输出当前命中的搜索源：

- `[dsh-web-search] AnySearch 返回结果 (5 条) | 关键词: "..."`
- `[dsh-web-search] AnySearch 请求异常，尝试降级到 Tavily: ...`
- `[dsh-web-search] Tavily 备用源返回结果 (5 条) | 关键词: "..."`

---

## License

MIT
