# Meridian 可观测性指南

一期简报出了问题，去哪查。代码是权威：记录端在 `apps/backend/src/lib/observability/index.ts`
与 `auto-brief-generation.ts`，查询端在 `apps/backend/src/routers/observability.ts`，
ai-worker 侧在 `services/meridian-ai-worker/src/services/observe.ts` 与 `llm-call-logger.ts`。

## 数据落在哪

按 `workflow_id`（cron 触发的形如 `cron-brief-<ts>`）串起来。

| 位置 | 内容 | 谁写 |
|---|---|---|
| DB `brief_runs` | 每个 run 一行：状态（`RUNNING` / `COMPLETED` / `DEGRADED` / `FAILED` / `TERMINATED_NO_STORIES`）、各阶段计数、`error` | 简报 workflow 的 `persist:brief_run_*` step |
| DB `brief_stories` | 每个候选块一行：标题、importance、article_ids、是否被选中（`selected_for_intel`） | `persist:brief_stories_and_rejections` |
| DB `reports` | 成稿 | `保存简报` |
| R2 `observability/<wf>.json` | `summary` + `detailedMetrics`（每次 `logStep` 都重写，run 中途崩溃也查得到） | `WorkflowObservability` |
| R2 `observability/clustering/<wf>.json` | `cluster_id → article_ids`（簇成员不进 DB，只在这里） | `执行聚类分析` |
| R2 `observability/article-journey/<wf>.json` | 文章去向表：每篇文章走到哪一关、被哪关拦下、进了哪一块 | 简报 workflow 末尾一次写入 |
| R2 `observability/brief-v3/<wf>.json` | 每块的 tier、正文、出处与成本；失败块以 `ok:false` 留档 | `简报标题` |
| R2 `llm-calls/<wf>/<phase>-<NNN>.json` | 每次 LLM 调用的原始输入输出 | ai-worker `llm-call-logger` |
| R2 `observability/sensors/<trace>/` | ai-worker 侧传感器（`output_language`、`brief_hygiene` 等） | ai-worker `sensor-log` |

ProcessArticles workflow 同样用 `WorkflowObservability` 写 `observability/<wf>.json`。

## 查询端点（backend，需 `Authorization: Bearer $API_TOKEN`）

以 `observability.ts` 的注册为准：

| 端点 | 给什么 |
|---|---|
| `GET /observability/runs/:workflowId` | `brief_runs` 行 + 该 run 的 `brief_stories` + R2 `observability/<wf>.json` |
| `GET /observability/runs/:workflowId/clustering` | R2 `observability/clustering/<wf>.json` |
| `GET /observability/runs/:workflowId/llm-calls` | 该 run 的 LLM 调用列表（key、大小、简要 metadata，不含正文） |
| `GET /observability/llm-calls/*` | 按 key 取单次调用的完整 JSON |
| `GET /observability/trends?days=14` | 按天聚合的 run 成败与故事指标（1–90 天） |
| `GET /observability/health/summary` | 最近 run、上一期简报、24h 文章统计 |

没有端点的 R2 对象（article-journey、brief-v3）用 `wrangler r2 object get meridian-articles-prod/<key> --remote` 取。

## 常见排查路径

1. **某期没出 / 出错**：`/health/summary` 找 run → `/runs/:wf` 看 `run.status` 与 `observability.detailedMetrics` 里
   `status === 'failed'` 的步骤和 `error`；再对 `wrangler workflows instances describe` 看平台侧状态
2. **状态是 DEGRADED**：触发条件只有两个（`degradedReasons`，只打进 Workers 日志、不落 DB）：
   块生成失败 ≥1 个、簇判定 NO_EVENT 率超 15%（正常 2–3%）。对应读数在 `detailedMetrics` 的
   `brief_blocks`（含 R2 取正文失败的分因 `contentStatus`）与 `story_validation`。
   NO_EVENT 率异常高时先查 ml-service 镜像是否过期：聚类响应里的 `build_identity` 为 `missing` = 跑的是旧镜像
3. **某件大事为什么没进简报**：article-journey 表按文章查它停在哪一关；
   被选中但没出块的看 brief-v3 记录里的 `ok:false`
4. **某块写得不对**：`/runs/:wf/llm-calls` 找到该块的 `brief_block_v6` 调用，取原始输入输出
5. **排序为什么这样**：`detailedMetrics` 里 `stepName` 为 `story_rank`（`roundsOk` 三轮成功几轮、`intersectionSize`、失败原因）
   与 `story_validation`（簇判定计数：`judgeFailures` / `pocketFlagged` / `unsureClusters`，正常应接近 0）

`detailedMetrics` 里现存的 `stepName`：`workflow_start`、`prepare_dataset`、`clustering_analysis`、
`story_validation`（现为簇判定，沿用旧名）、`story_rank`、`brief_blocks`、`brief_generation`、`save_brief`、
`workflow_complete` / `workflow_terminated`；ProcessArticles 另有 `fetch_articles`、`content_fetch`、`llm_analysis`。

## 本地复现一期

`pnpm -F @meridian/backend replay <workflowId>` 用该 run 在 `llm-calls/` 里的录像作答，在本地把整期
workflow 重跑一遍并与生产产出逐字段比对（前置条件与局限见 `apps/backend/test/replay/README.md`）。

## ai-worker 请求级观测：`observeMiddleware`

- **自动记**：请求本身成一个 span（耗时、成败、异常）；请求内经 `callLLM` / `loggedChat` 的 LLM 调用自动挂到它下面
  （prompt、原始输出、finish_reason、usage），父子关系靠 `AsyncLocalStorage`
- **去向按请求头选**：
  - `x-observe: inline` → 记录随 JSON 响应的 `observation` 字段带回，**不写 R2**。开发 / 验收脚本用
    （本地 `wrangler dev` 直连生产桶，写了就是污染）
  - 只有 `x-trace-id` → LLM I/O 由 `llm-call-logger` 落 `llm-calls/`，不记 span
  - 都没有 → 不记
- **跨请求**（backend → ai-worker、step 重试）靠 `x-trace-id` 头传；ALS 只在一次请求内有效
- **没经过 `loggedChat` 的 LLM 调用记不到**（如 `/meridian/chat` 直接调 `AIGatewayService.chat`）
- 设计依据：`docs/engineering-notes/llm-observability-integration-patterns.md`（仅本地）

## 其他入口

- 生产日志：`wrangler tail`，本机建不起会话时走 CF Dashboard → Workers → Logs
- 成本与用量：CF GraphQL / Dashboard；AI Gateway 面板看 LLM 请求与缓存
