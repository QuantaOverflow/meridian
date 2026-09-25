# Meridian Backend HTTP 路由

路由挂载在 `src/app.ts`，实现在 `src/routers/*.ts`。本文只列路由、鉴权与入参要点；
字段细节以 handler 与其 zod schema 为准。

- 本地：`http://localhost:8787`；生产：`https://meridian-backend.swj299792458.workers.dev`
- 鉴权：`Authorization: Bearer <API_TOKEN>`（`src/lib/core/utils.ts` 的 `hasValidAuthToken`；`API_TOKEN` 未配置时一律拒绝）
- `/admin/*` 的写操作响应形如 `{ success, data?, message?, error?, timestamp }`（`src/lib/api/utils.ts`）；`/reader/*` 与 `GET /admin/sources*` 直接回数据、404 回 `{ error }`；其余路由各自返回

## 路由表

| 方法 与 路径 | 鉴权 | 说明 |
|---|---|---|
| `GET /ping` | 无 | `{ pong: true }` |
| `GET /openGraph/default` | 无 | 默认 OG 图（PNG） |
| `GET /openGraph/brief?title&date&articles&sources` | 无 | 简报 OG 图；`date` 是毫秒时间戳 |
| `GET /events?date&pagination&page&limit` | 需要 | 已处理文章列表，含 R2 正文；`limit` 1–1000，默认 100 |
| `GET /reader/briefs?q&limit&offset` | token | 简报归档：`q` ILIKE 子串检索（≤200 字），`limit` 1–50 默认 20，`offset` ≥0。回 `{items, matched, total, earliest}`（前端 `/api/briefs` 的数据源，下同） |
| `GET /reader/briefs/latest`、`GET /reader/briefs/:id` | token | 一期简报：正文 markdown 原文 + 简报级来源清单；不存在回 404 |
| `GET /reader/stories`、`GET /reader/stories/:id` | token | 跨期线索列表 / 单条（含各期条目）；状态与「升级中」在这里判定，不到门槛的簇回 404 |
| `GET /admin/sources` | token | 后台源总览：每个源近 7 天的文章数与健康度、全局的今日计数与过期源数 |
| `GET /admin/sources/:id/details?page&status&completeness&quality&sortBy&sortOrder` | token | 单个源的文章列表，每页 50；不认识的筛选值等于不筛选；源不存在回 404 |
| `POST /admin/sources` | token | 新建 RSS 源：`{url, name?, category?, scrape_frequency?}`（默认 `Unknown` / `news` / 2）；URL 重复回 409。插入后立即启动该源的 DO，启动失败则撤销插入、回 500 |
| `PUT /admin/sources/:id` | token | 部分更新同上字段；改 url 会停掉旧 url 的 DO、按新 url 启动，改档位会重新初始化 DO（暂停中的源只改表） |
| `POST /admin/briefs/generate` | token | 启动 `AutoBriefGenerationWorkflow`，回 202 + `workflowId`；空体也要传 `{}`。可选字段见下 |
| `POST /admin/articles/process` | token | `{article_ids: number[]}`（≥1）→ 启动 `ProcessArticles` workflow，回 202 |
| `POST /do/admin/source/:sourceId/init` | token | 按数据库里的源（数字 id）初始化它的 `SourceScraperDO` |
| `POST /do/admin/source/:sourceId/pause` | token | 暂停自动抓取：记 `paused_at`、停掉 DO；源与已有文章保留 |
| `POST /do/admin/source/:sourceId/resume` | token | 恢复自动抓取：清 `paused_at`、重新启动 DO |
| `POST /do/admin/initialize-dos?batchSize=100` | token | 为**尚未初始化**（`do_initialized_at IS NULL`）且未暂停的源批量初始化 DO，回 `{initialized, total}` |
| `DELETE /do/admin/source/:sourceId` | token | 在一个事务里删除该源的文章和 sources 行，再销毁 DO、删掉这些文章在 R2 里的正文；有文章被简报故事当代表文章引用时回 409（表与 DO 都不动，改用暂停） |
| `GET\|POST /do/source/:sourceKey/*` | 需要 | 透传到 DO 的 `fetch`：`GET …/status`、`POST …/force-scrape`。`:sourceKey` 是 **URL 编码后的源 URL**（DO 以 `idFromName(source.url)` 定位），不是数字 id |
| `GET /observability/runs/:workflowId` | token | 一次简报运行的全貌：`brief_runs` + stories + R2 观测快照 |
| `GET /observability/runs/:workflowId/clustering` | token | R2 `observability/clustering/<wf>.json` 聚类快照 |
| `GET /observability/runs/:workflowId/llm-calls` | token | 列出 R2 `llm-calls/<wf>/` 下的 LLM 调用记录 |
| `GET /observability/llm-calls/<key>` | token | 读取单条 LLM 调用记录，`<key>` 必须以 `llm-calls/` 开头 |
| `GET /observability/trends?days=14` | token | 按天的运行 / 故事趋势，`days` 1–90 |
| `GET /observability/health/summary` | token | 当日运行状态、文章数、最后一次成功简报 |

`/admin/*`、`/reader/*`、`/observability/*`、`/do/*`、`/events` 的鉴权都挂在 `app.ts` 的挂载处（2026-09-24 起；此前
`/do/source/*` 无鉴权、`/events` 的中间件挂错了对象从未生效）。只有 `/openGraph/*`、`/ping` 公开。

## `POST /admin/briefs/generate` 的可选字段

全部可选（`src/routers/admin.ts` 的 `briefGenerateSchema`），默认值在 handler 里：

| 字段 | 默认 | 说明 |
|---|---|---|
| `article_ids` | — | 指定文章；给了就不按时间选 |
| `dateFrom` / `dateTo` | — | ISO 时间；不给则用 `timeRangeDays` |
| `timeRangeDays` | 1 | |
| `articleLimit` | 500 | |
| `maxStoriesToGenerate` | 25 | |
| `clusteringOptions` | `BRIEF_CLUSTERING_OPTIONS` | 见 `src/lib/core/constants.ts` |
| `triggeredBy` | `admin` | |

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
