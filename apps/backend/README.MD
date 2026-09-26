# @meridian/backend

Meridian 的主 Worker（Cloudflare Worker `meridian-backend`）：抓 RSS、处理文章、编排每日简报，
并提供 admin / 观测 HTTP 路由。LLM 调用交给 `services/meridian-ai-worker`（service binding `AI_WORKER`），
embedding 与聚类交给 `services/meridian-ml-service`（service binding `ML_SERVICE`）。

## 三个入口（`src/index.ts`）

| 入口 | 触发 | 做什么 |
|---|---|---|
| `fetch` | HTTP | Hono app（`src/app.ts`），路由见 [`docs/API_GUIDE.md`](docs/API_GUIDE.md) |
| `scheduled` | cron `0 13 * * *`（UTC 13:00 = 北京 21:00） | `src/lib/scheduled/daily-brief.ts` 启动当天的简报 workflow |
| `queue` | `meridian-article-processing-queue-prod` | 每批文章 id 启动一个 `ProcessArticles` workflow |

## 管线

1. **抓取**：每个源一个 `SourceScraperDO`（`src/durable_objects/sourceScraperDO.ts`，以源 URL 为 DO 名），
   按 `scrape_frequency` 用 alarm 定时抓 RSS，新文章入库后把 id 发到队列。
2. **ProcessArticles**（`src/workflows/processArticles.workflow.ts`）：抓正文（`src/lib/services/article-fetchers.ts`，
   需要时走 Browser Run binding `BROWSER`）→ 正文存 R2 → ai-worker `/meridian/article/analyze` 写结构化字段。
   这一步不算 embedding。
3. **AutoBriefGenerationWorkflow**（`src/workflows/auto-brief-generation.ts`）：
   批量补算缺失 embedding（ml-service `/embeddings`）→ 聚类（ml-service `/ai-worker/clustering`，
   客户端 `src/lib/services/ml-service.ts`）→ 每簇 ai-worker `/meridian/cluster/judge` →
   `blockImportance` + `/meridian/stories/rank` 排序 → 每块 `/meridian/brief-block-v6` →
   `/meridian/brief-title`、`/meridian/generate-brief-summary` → 写 `reports`。

编排细节见根 `README.md` 的「How It Works」一节；
现行链路与已证伪路线见 [`docs/adr/0003-cluster-as-brief-block.md`](../../docs/adr/0003-cluster-as-brief-block.md)。
跨服务调用的契约是 `src/lib/services/ai-services.ts` 里的客户端方法。

## 绑定与配置（`wrangler.jsonc`）

| 名称 | 类型 | 说明 |
|---|---|---|
| `HYPERDRIVE` | Hyperdrive | Neon Postgres；本地用 `localConnectionString` |
| `ARTICLES_BUCKET` | R2 `meridian-articles-prod`（`remote: true`） | 文章正文 + 观测数据；本地 dev 也读写生产桶 |
| `ARTICLE_PROCESSING_QUEUE` | Queue | 生产者与消费者都是本 Worker，DLQ `meridian-article-processing-dlq` |
| `SOURCE_SCRAPER` | Durable Object | `SourceScraperDO` |
| `PROCESS_ARTICLES` / `AUTO_BRIEF` | Workflow | `ProcessArticles` / `AutoBriefGenerationWorkflow` |
| `AI_WORKER` | Service binding | `meridian-ai-worker` |
| `BROWSER` | Browser Run（`remote: true`） | 抓取降级到浏览器时调 `quickAction('content')`；无本地模拟，本地 dev 也走真实 Browser Run、产生用量。要求 `compatibility_date >= 2026-03-24` |
| `ML_SERVICE` | Service binding | `meridian-ml-service`；本地 dev 由 `services/meridian-ml-service/dev-shim` 顶替 |

Secret（本地复制 `.dev.vars.example` 为 `.dev.vars`；生产在本目录 `npx wrangler@4.120.0 secret put <NAME>`）：

- `API_TOKEN`：`/admin/*`、`/observability/*`、`/do/admin/*` 的 Bearer token

## 命令

```bash
pnpm -F @meridian/backend dev          # wrangler dev，默认 :8787
pnpm -F @meridian/backend typecheck    # tsc --noEmit
pnpm -F @meridian/backend test         # vitest run（workers pool）
pnpm -F @meridian/backend replay <wf>  # 录像重放全链路，见 test/replay/README.md
pnpm -F @meridian/backend cf-typegen   # 按 wrangler.jsonc 重新生成 worker-configuration.d.ts

# 部署：只在本目录，永不从仓库根部署
cd apps/backend && npx wrangler@4.120.0 deploy
```

包名必须写 `@meridian/backend`；写成 `meridian-backend` 时 pnpm 找不到包却静默退出 0。
backend 与 ai-worker / ml-service 本地联调、R2 注意事项见 `.claude/rules/workers.md`。

## 测试

- [`test/README.md`](test/README.md)：vitest（workers pool）单测 + 简报纯函数的 golden 快照
- [`test/replay/README.md`](test/replay/README.md)：拿一期生产 run 的 LLM 录像重放整个简报 workflow，与生产产出逐字段比对

## 目录

```
src/
  index.ts / app.ts        入口与路由挂载
  routers/                 admin、durableObjects、events、observability、openGraph
  workflows/               processArticles、auto-brief-generation
  durable_objects/         SourceScraperDO
  lib/core/                简报链路的纯函数（cluster-blocks、storyline、story-ranking、brief-v3 …）
  lib/services/            ai-services（ai-worker / ml-service 客户端）、clustering、article-fetchers
  lib/scheduled/           每日 cron
  lib/story-clusters.ts    跨期线索归并
scripts/                   运维脚本，见 scripts/README.md
docs/API_GUIDE.md          HTTP 路由表
```

## 相关文档

- 部署：根 `README.md` 的「Deployment」一节
- 观测与排错：根 `README.md` 的「Monitoring & Observability」一节
- 数据表：[`packages/database/README.MD`](../../packages/database/README.MD)
