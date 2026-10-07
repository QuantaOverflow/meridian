# Meridian Backend HTTP 路由

路由挂载在 `src/app.ts`，实现在 `src/routers/*.ts`。本文只列路由、鉴权与入参要点；
字段细节以 handler 与其 zod schema 为准。

- 本地：`http://localhost:8787`；生产：`https://meridian-backend.swj299792458.workers.dev`
- 鉴权：`Authorization: Bearer <API_TOKEN>`（`src/lib/core/utils.ts` 的 `hasValidAuthToken`；`API_TOKEN` 未配置时一律拒绝）
- 调用方：「前端」= frontend 的 server 在调；「运维」= 人手 curl 或排错时调。pre-push 的 `scripts/check-routes.mjs` 按这一列对账——「前端」行必须在前端代码里找到调用，「运维」行本身就算调用方；新增、删除路由时同步改这张表
- `/admin/*` 的写操作响应形如 `{ success, data?, message?, error?, timestamp }`（`src/lib/api/utils.ts`）；`/reader/*`、`GET /admin/sources/:id/details` 与运维台的 `/observability/ops/*` 直接回数据、404 回 `{ error }`；其余路由各自返回

## 路由表

| 方法 与 路径 | 鉴权 | 调用方 | 说明 |
|---|---|---|---|
| `GET /ping` | 无 | 运维 | `{ pong: true }` |
| `GET /openGraph/default` | 无 | 前端 | 默认 OG 图（PNG） |
| `GET /openGraph/brief?title&date&articles&sources` | 无 | 前端 | 简报 OG 图；`date` 是毫秒时间戳 |
| `GET /events?date&pagination&page&limit` | 需要 | 运维 | 已处理文章列表，含 R2 正文；`limit` 1–1000，默认 100 |
| `GET /reader/briefs?q&limit&offset` | token | 前端 | 简报归档：`q` ILIKE 子串检索（≤200 字），`limit` 1–50 默认 20，`offset` ≥0。回 `{items, matched, total, earliest}`（前端 `/api/briefs` 的数据源，下同） |
| `GET /reader/briefs/latest`、`GET /reader/briefs/:id` | token | 前端 | 一期简报：正文 markdown 原文 + 简报级来源清单；不存在回 404 |
| `GET /reader/briefs/:id/map` | token | 前端 | 地图首页数据（形状见 `@meridian/contracts` 的 `BriefMap`）：正文块按 brief-v3 记录的 clusterId 对回故事，带国家占比、主题、过门槛的线索，以及当期窗口按国家的文章统计；只有 `:id` 形式，可见性同单期页，不存在回 404 |
| `GET /reader/countries/:code/blocks?section&limit&offset` | token | 前端 | 国家页的一节（形状见 `@meridian/contracts` 的 `CountryBlocksPage`）：`section` 是 `placement`（落点在该国，默认）或 `mention`（涉及该国），`limit` 1–50 默认 20。只含已发布各期的块，按期倒序；`:code` 是两位国家代码（不分大小写），不在地点归一表里回 404 |
| `GET /reader/following?countries&threads&limit&offset` | token | 前端 | Following 页（形状见 `@meridian/contracts` 的 `FollowingPage`）：命中任一关注项的块，只含已发布各期的块，按期倒序。`countries` 是逗号分隔的两位国家代码（落点在该国 + 涉及该国，后者在 `matches` 里标 `via: mention`；不在地点归一表里的代码略过），`threads` 是逗号分隔的线索号；每类最多 100 个，写法不对回 400，两类都空回空页 |
| `GET /reader/search?q&limit&offset` | token | 前端 | 搜索简报块（形状见 `@meridian/contracts` 的 `SearchPage`）：Postgres 英文全文检索（`websearch_to_tsquery`，词形还原、引号短语、`-词` 排除），只搜已发布各期的块的标题与正文。结果按线索折成组，`limit`（1–50 默认 20）与 `offset` 按组数；`q` 去首尾空白后为空或超过 200 字回 400 |
| `GET /reader/stories`、`GET /reader/stories/:id` | token | 前端 | 跨期线索列表 / 单条（含各期条目）；状态与「升级中」在这里判定，不到门槛的簇回 404 |
| `GET /admin/sources/:id/details?page&status&completeness&quality&sortBy&sortOrder` | token | 前端 | 单个源的文章列表，每页 50；不认识的筛选值等于不筛选；源不存在回 404 |
| `POST /admin/sources` | token | 前端 | 新建 RSS 源：`{url, name?, category?, scrape_frequency?}`（默认 `Unknown` / `news` / 2）；URL 重复回 409。插入后立即启动该源的 DO，启动失败则撤销插入、回 500 |
| `PUT /admin/sources/:id` | token | 运维 | 部分更新同上字段；改 url 会停掉旧 url 的 DO、按新 url 启动，改档位会重新初始化 DO（暂停中的源只改表） |
| `POST /admin/briefs/generate` | token | 运维 | 启动 `AutoBriefGenerationWorkflow`，回 202 + `workflowId`；空体也要传 `{}`。可选字段见下 |
| `POST /admin/briefs/run-scheduled` | token | 运维 | 只在 staging 存在（`ENVIRONMENT` 不是 `staging` 时 404）：调 cron 用的同一个触发函数，起一次 Staging 运行，回 202 + `workflowId`；已有运行在飞回 409 + `blockingWorkflowId`。调用方是 `scripts/staging-run.mjs`（ADR 0013） |
| `POST /admin/articles/process` | token | 运维 | `{article_ids: number[]}`（≥1）→ 启动 `ProcessArticles` workflow，回 202 |
| `POST /do/admin/source/:sourceId/init` | token | 前端 | 按数据库里的源（数字 id）初始化它的 `SourceScraperDO` |
| `POST /do/admin/source/:sourceId/pause` | token | 前端 | 暂停自动抓取：记 `paused_at`、停掉 DO；源与已有文章保留 |
| `POST /do/admin/source/:sourceId/resume` | token | 前端 | 恢复自动抓取：清 `paused_at`、重新启动 DO |
| `POST /do/admin/initialize-dos?batchSize=100` | token | 运维 | 为**尚未初始化**（`do_initialized_at IS NULL`）且未暂停的源批量初始化 DO，回 `{initialized, total}` |
| `DELETE /do/admin/source/:sourceId` | token | 前端 | 在一个事务里删除该源的文章和 sources 行，再销毁 DO、删掉这些文章在 R2 里的正文；有文章被简报故事当代表文章引用时回 409（表与 DO 都不动，改用暂停） |
| `GET\|POST /do/source/:sourceKey/*` | 需要 | 运维 | 透传到 DO 的 `fetch`：`GET …/status`、`POST …/force-scrape`。`:sourceKey` 是 **URL 编码后的源 URL**（DO 以 `idFromName(source.url)` 定位），不是数字 id |
| `GET /observability/runs/:workflowId` | token | 运维 | 一次简报运行的全貌：`brief_runs` + stories + R2 观测快照 |
| `GET /observability/runs/:workflowId/clustering` | token | 运维 | R2 `observability/clustering/<wf>.json` 聚类快照 |
| `GET /observability/runs/:workflowId/llm-calls` | token | 运维 | 列出 R2 `llm-calls/<wf>/` 下的 LLM 调用记录 |
| `GET /observability/llm-calls/<key>` | token | 运维 | 读取单条 LLM 调用记录，`<key>` 必须以 `llm-calls/` 开头 |
| `GET /observability/ops/health` | token | 前端 | 运维台 Health：今天的生产运行与灯、近 24 小时入库、各服务版本、来源异常、本周期花费、最近 14 次生产运行（`OpsHealth`） |
| `GET /observability/ops/trends?days=30` | token | 前端 | 运维台 Trends：生产运行、按北京日的入库与 Worker 报错、核查结果，`days` 7–90（`OpsTrends`） |
| `GET /observability/ops/cost?cycle=current\|previous` | token | 前端 | 运维台 Cost：一个 Cloudflare 计费周期的模型花费、生产占比、按模型与按北京日的用量（`OpsCost`） |
| `GET /observability/ops/sources` | token | 前端 | 运维台 Sources：每个源的来源异常判定与近 7 天读数（`OpsSources`） |
| `GET /observability/ops/runs/:workflowId` | token | 前端 | 运维台运行详情：灯、run 汇总、各块的核查结果（`OpsRunDetail`）；查不到回 404 |
| `GET /observability/ops/services` | token | 运维 | backend、ai-worker、ml-service 三个服务各自的版本（`OpsServiceVersion[]`，顺序固定）。后两个经 service binding 现读；够不着的是 `health: "unknown"`、各项 null，不报错。会唤醒睡着的 ml 容器 |

`/admin/*`、`/reader/*`、`/observability/*`、`/do/*`、`/events` 的鉴权都挂在 `app.ts` 的挂载处（2026-09-24 起；此前
`/do/source/*` 无鉴权、`/events` 的中间件挂错了对象从未生效）。只有 `/openGraph/*`、`/ping` 公开。

## `POST /admin/briefs/generate` 的可选字段

全部可选（`src/routers/admin.ts` 的 `briefGenerateSchema`），默认值在 handler 里：

| 字段 | 默认 | 说明 |
|---|---|---|---|
| `article_ids` | — | 运维 | 指定文章；给了就不按时间选 |
| `dateFrom` / `dateTo` | — | 运维 | ISO 时间；不给则用 `timeRangeDays` |
| `timeRangeDays` | 1 | 运维 | |
| `articleLimit` | 500 | 运维 | |
| `maxStoriesToGenerate` | 25 | 运维 | |
| `clusteringOptions` | `BRIEF_CLUSTERING_OPTIONS` | 运维 | 见 `src/lib/core/constants.ts` |
| `triggeredBy` | `admin` | 运维 | |

```bash
curl -X POST http://localhost:8787/admin/briefs/generate \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" -d '{}'
```

每日定时简报不走这个路由：`wrangler.jsonc` 的 cron（UTC 13:00）触发 `src/index.ts` 的 `scheduled()`。

## 新增一个 RSS 源

```bash
# 1. 写库，记下返回的 data.id
curl -X POST http://localhost:8787/admin/sources \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Example","url":"https://example.com/feed.xml","category":"news"}'

# 2. 初始化该源的 DO，否则它不会被抓取
curl -X POST http://localhost:8787/do/admin/source/<id>/init -H "Authorization: Bearer $API_TOKEN"
```

`scrape_frequency`：1 = 每小时，2 = 每 4 小时（默认），3 = 每 6 小时，4 = 每天（`packages/database/src/schema.ts`）。

## 文章状态（`article_status` 枚举）

`PENDING_FETCH`、`CONTENT_FETCHED`、`PROCESSED`、`SKIPPED_PDF`、`SKIPPED_TOO_OLD`、
`FETCH_FAILED`、`RENDER_FAILED`、`AI_ANALYSIS_FAILED`、`EMBEDDING_FAILED`、`R2_UPLOAD_FAILED`。
权威定义在 [`packages/database/src/schema.ts`](../../../packages/database/src/schema.ts)。

## 相关

- 服务总览：[`../README.MD`](../README.MD)
- 观测路由怎么用：根 `README.md` 的「Monitoring & Observability」一节
