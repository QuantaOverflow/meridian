# meridian-ai-worker

Meridian 管线里所有 LLM 调用的出口。Cloudflare Worker（Hono），backend 经 service binding
`AI_WORKER` 调它；它自己不碰数据库，只读写 R2 做观测落盘。

## 在管线里的位置

```
抓取 (SourceScraperDO) → queue → ProcessArticles ──► /meridian/article/analyze
AutoBriefGeneration ─► ml-service /embeddings          （聚类前批量补算缺失 embedding）
                    ─► ml-service /ai-worker/clustering
                    ─► /meridian/cluster/judge        （一簇一次）
                    ─► blockImportance（backend 代码）+ /meridian/stories/rank
                    ─► /meridian/brief-block-v6       （一块一次）
                    ─► /meridian/brief-title → /meridian/generate-brief-tldr → /meridian/generate-brief-summary
```

embedding 和聚类不在本服务，在 `services/meridian-ml-service`。
backend 侧的调用方法在 `apps/backend/src/lib/services/ai-services.ts`，那里的客户端方法就是契约。

## 路由（`src/index.ts`，共 9 条）

请求/响应形状以 handler 为准；除 `/health` 外都返回 `{ success, data?, error?, metadata? }`。

| 路由 | 用途 | 调用方 |
|---|---|---|
| `GET /health` | 存活检查 | — |
| `POST /meridian/article/analyze` | `{title, content}` → 单篇结构化分析（语言、地点、摘要点、关键词、实体…），字段契约见 `prompts/articleAnalysis.ts` 的 `articleAnalysisSchema` | ProcessArticles |
| `POST /meridian/cluster/judge` | `{articles:[{id,title,…}]}`（≥2 篇）→ `verdict` EVENT / NO_EVENT / UNSURE + 标题；解析失败回 500，不伪装成 NO_EVENT | AutoBriefGeneration |
| `POST /meridian/stories/rank` | `{candidates:[{id,title,articles}]}` → 三轮洗牌 + Borda 聚合取前 12（`services/story-rank.ts`）；三轮全败回 500 | AutoBriefGeneration |
| `POST /meridian/brief-block-v6` | `{title, articles:[{id,title,content}], tier?}` → 一簇写成一块简报（`services/brief-block-v6.ts`）；`tier` = `lead` / `more` / `brief` | AutoBriefGeneration |
| `POST /meridian/brief-title` | `{content}` → 整期标题 | AutoBriefGeneration |
| `POST /meridian/generate-brief-tldr` | `{briefTitle, briefContent}` → `tldr`（机器格式，给次日管线读，不给读者看） | AutoBriefGeneration |
| `POST /meridian/generate-brief-summary` | `{briefTitle, briefContent}` → `tldrProse`（读者端 2-3 句摘要） | AutoBriefGeneration、`apps/backend/scripts/backfill-tldr-prose.ts` |
| `POST /meridian/chat` | 透传口：`{messages, options?}`，`options` 的白名单字段见 handler；默认 provider `dashscope` / `qwen-plus` | `eval/cluster-to-brief`（`slow-lib.mjs`、`arms/direct-raw`）、手动脚本 `tests/test-llama-3.3.js` |

所有路由都**没有鉴权**：`services/auth.ts` 的 `AuthenticationService` 只在
`AIGatewayService.processRequestWithAuth` 里用到，而这个方法没有调用方。

## LLM 调用怎么走

- 除 article analyze 与 `/meridian/chat` 外，所有调用都经 `src/services/call-llm.ts` 的
  `callLLM(phase)`：每个 phase 在 `PHASE_DEFAULTS` 里有一套 provider / model / temperature /
  maxTokens / skipCache 默认值，caller 只覆盖真不同的。
- 现行 phase 全部默认 `workers-ai` + `@cf/zai-org/glm-4.7-flash`，经 **`env.AI` binding** 调用
  （`AIGatewayService.executeWorkersAIViaBinding`）。思维链由 `config/thinking.ts` 关掉。
- article analyze 在 `index.ts` 自带两档重试：`@cf/qwen/qwen3-30b-a3b-fp8` → `@cf/zai-org/glm-4.7-flash`。
- **Workers AI binding 调用目前不经 AI Gateway**：`executeWorkersAIViaBinding` 刻意不传 `gateway`
  参数（原因见该处注释）。只有非 workers-ai 的 provider（如 `/meridian/chat` 默认的 dashscope）走
  `https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}`。
- 经 `callLLM` 的调用都会做输出语言检测（`checkOutputLanguage`），CJK 占比超阈值只告警、落 sensor，不改输出。

## 环境变量与 secret

本地复制 `.dev.vars.example` 为 `.dev.vars`；生产在本目录 `npx wrangler@4.120.0 secret put <NAME>`。
代码实际读取的（`src/types.ts` 的 `CloudflareEnv` + `ai-gateway.ts`）：

| 名称 | 作用 |
|---|---|
| `AI`（binding，`wrangler.toml` 的 `[ai]`） | Workers AI，现行所有 phase 走这里；无需 token |
| `ARTICLES_BUCKET`（R2 binding） | 观测落盘 + 读文章正文，与 backend 同一个桶 `meridian-articles-prod` |
| `CF_VERSION_METADATA`（binding） | span 里的 `deployment_version` |
| `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_GATEWAY_ID` | 拼 AI Gateway URL（非 workers-ai provider 用）；没有 account id 时会注册 mock provider |
| `AI_GATEWAY_TOKEN` 🔐 | Gateway 开了鉴权时发 `cf-aig-authorization` |
| `DASHSCOPE_API_KEY` 🔐 | 注册 dashscope provider（`/meridian/chat` 默认用它）；2026-07-29 起该 key 返回 401，现行管线不依赖它 |
| `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GOOGLE_AI_API_KEY`、`CLOUDFLARE_API_TOKEN` 🔐 | 有值才注册对应 provider；`CLOUDFLARE_API_TOKEN` 是 Workers AI 的 REST 通道，binding 在时用不上 |
| `ENABLE_COST_TRACKING`、`DEFAULT_CACHE_TTL`、`ENABLE_DETAILED_LOGGING`、`LOG_LEVEL` | Gateway 请求头 / 日志开关 |
| `DEFAULT_MAX_RETRIES`、`DEFAULT_RETRY_DELAY_MS` | `AIGatewayService` 的重试参数 |
| `ENVIRONMENT` | `wrangler.toml` 的 `[env.*].vars` 设置；`development` 时注册 mock provider |
| `GATEWAY_API_KEYS`、`API_SECRET_KEY`、`ALLOWED_ORIGINS` | 只被 `AuthenticationService` 读，而它不在任何路由上（见上） |

## 观测数据落在哪

只在请求带 `x-trace-id` 头时写 R2（桶 `meridian-articles-prod`）：

- `llm-calls/{trace_id}/{phase}-{idx}.json`：一次 LLM 调用的完整输入/输出（`services/llm-call-logger.ts`）；`idx` 取 `x-call-index` 头或 `callLLM` 的 `callIndex`
- `observability/sensors/{trace_id}/{kind}-{idx}.json`：传感器读数，例如输出语言告警（`services/sensor-log.ts`）
- `observability/spans/{trace_id}/…`：管线内部各段的结构化记录（`services/span-log.ts`）

请求带 `x-observe: inline` 时不写 R2，记录随响应的 `observation` 字段返回（`services/observe.ts`），用于本地验收。
读这些数据的入口是 backend 的 `/observability/*` 路由，见 [`docs/OBSERVABILITY_GUIDE.md`](../../docs/OBSERVABILITY_GUIDE.md)。

## 开发、测试、部署

```bash
# 本地起服务。wrangler.toml 的 R2 是 remote = true（需 wrangler ≥ 4.37，本包锁的 3.x 不够），
# 所以用 pinned 版本；本地 dev 的 R2 写入会落生产桶
cd services/meridian-ai-worker && npx wrangler@4.120.0 dev --port 8787

pnpm -F meridian-ai-worker typecheck          # tsc --noEmit
pnpm -F meridian-ai-worker exec vitest run    # test/（golden 快照）+ tests/（auth / metadata / retry 单元测试）

# 部署：只在本目录，永不从仓库根部署
cd services/meridian-ai-worker && npx wrangler@4.120.0 deploy
```

- `test/*.golden.test.ts` 是 golden 快照：输入取自生产 run 的真实 LLM 输出，行为有意改变时用
  `UPDATE_GOLDEN=1 pnpm exec vitest run <file>` 重写快照（见各文件头注释）。
- 全链路回归（backend workflow + 本服务，LLM 回答用录像回放）见
  [`apps/backend/test/replay/README.md`](../../apps/backend/test/replay/README.md)。
- 改 prompt（`src/prompts/`）前后要跑 `eval/` 评估。

## 相关文档

- 现行简报链路与已证伪路线：[`docs/adr/0003-cluster-as-brief-block.md`](../../docs/adr/0003-cluster-as-brief-block.md)
- 写作层：[`docs/adr/0004-brief-writer-v3.md`](../../docs/adr/0004-brief-writer-v3.md)
- 工作流编排：[`docs/meridian-workflow-architecture.md`](../../docs/meridian-workflow-architecture.md)
- 部署：[`docs/DEPLOYMENT_GUIDE.md`](../../docs/DEPLOYMENT_GUIDE.md)
