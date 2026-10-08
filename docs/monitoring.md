# Monitoring & observability

Runbook for figuring out what went wrong with a given brief run. Recording code: `apps/backend/src/lib/observability/index.ts` and `auto-brief-generation.ts`; query code: `apps/backend/src/routers/observability.ts`. Everything keys on `workflow_id` (cron runs look like `cron-brief-<ts>`).

**Where data lands**

| Location | Content | Written by |
|---|---|---|
| DB `brief_runs` | one row per run: status (`RUNNING` / `COMPLETED` / `DEGRADED` / `FAILED` / `TERMINATED_NO_STORIES`), per-phase counts, `error` | the workflow's `persist:brief_run_*` steps |
| DB `brief_stories` | one row per candidate block: title, importance, article ids, whether it was selected (`selected_for_intel`) | `persist:brief_stories_and_rejections` |
| DB `reports` | the finished brief | the save-brief step |
| DB `brief_blocks` | one row per written brief block: the brief, the story, tier, position, title, body, full-text search column (ADR 0014) | the save-brief step, same transaction as `reports` |
| R2 `observability/<workflowId>.json` | `summary` + `detailedMetrics`, read-merged-written on every step (readable even if the run crashes mid-way; when the Workflow replays `run()` after hibernation or a retry, entries already recorded keep their original timestamps and durations) | `WorkflowObservability` |
| R2 `observability/clustering/<workflowId>.json` | `cluster_id → article_ids` (cluster membership never hits the DB) | the clustering step |
| R2 `observability/article-journey/<workflowId>.json` | per-article trace: which gate it hit, which block it landed in | end of the brief workflow |
| R2 `observability/brief-v3/<workflowId>.json` | each block's tier, text, sources and cost; failed blocks kept with `ok:false` | the title step |
| R2 `llm-calls/<workflowId>/<phase>-<NNN>.json` | raw input/output of every LLM call | ai-worker's `llm-call-logger` |
| R2 `observability/sensors/<trace>/` | ai-worker-side sensors (currently only `output_language`) | ai-worker's `sensor-log` |

`ProcessArticles` writes the same `observability/<workflowId>.json` shape.

**Query endpoints** (backend, need `Authorization: Bearer $API_TOKEN`)

| Endpoint | Returns |
|---|---|
| `GET /observability/runs/:workflowId` | `brief_runs` row + that run's `brief_stories` + R2 `observability/<workflowId>.json` |
| `GET /observability/runs/:workflowId/clustering` | R2 `observability/clustering/<workflowId>.json` |
| `GET /observability/runs/:workflowId/llm-calls` | list of that run's LLM calls (key, size, brief metadata — no bodies) |
| `GET /observability/llm-calls/*` | full JSON of one call, by key |
| `GET /observability/ops/health` | ops console Health: today's production run and its level, 24 h ingest, service versions, source problems, cycle spend, last 14 production runs |
| `GET /observability/ops/trends?days=30` | production runs, ingest per Beijing day, Worker errors, check outcomes (7–90 days) |
| `GET /observability/ops/cost?cycle=current\|previous` | Workers AI spend for a Cloudflare billing cycle, production share, usage by model and day |
| `GET /observability/ops/sources` | every source with its problem kind (not checked, dead feed, fetch failing, bad body, paused) and 7-day numbers |
| `GET /observability/ops/runs/:workflowId` | one run for the console: level, run summary (`brief_runs.ops_summary`), blocks with check outcomes |
| `GET /observability/ops/services` | deployed commit, title, deploy time and health of backend, ai-worker, ml-service |

The `ops/*` endpoints back the ops console in the admin UI (`/admin`: Health, Trends, Cost, Sources, run detail; read-only, production runs only). Cloudflare-derived panels need the backend secret `CF_ANALYTICS_TOKEN` (Account Analytics: Read); without it they show "not available" and the rest still works.

R2 objects with no endpoint (article-journey, brief-v3) need `wrangler r2 object get meridian-articles-prod/<key> --remote`.

**Common troubleshooting paths**

1. **A brief didn't come out / errored**: the console's Health page (or `/ops/health`) to find the run → `/runs/:wf` for `run.status` and any `detailedMetrics` step with `status === 'failed'` and its `error`; cross-check `wrangler workflows instances describe` for platform-level state
2. **Status is `DEGRADED`**: three triggers (`degradedReasons`: in `brief_runs.ops_summary` and on the console's run page for runs since 2026-10; Workers logs only for older runs): ≥1 failed block; a cluster NO_EVENT rate above 15% (normally 2–3%); or the ML Service image identity check failing (`missing` = an old image without `build_identity` — also recorded as `buildIdentityCheck` in `observability/clustering/<wf>.json`). Check `detailedMetrics.brief_blocks` / `story_validation`. A high NO_EVENT rate usually means a stale ML Service image too
3. **Why didn't a big story make the brief**: look up the article in article-journey to see which gate stopped it; a selected-but-missing block shows up as `ok:false` in the brief-v3 record
4. **A block reads wrong**: find its `brief_block_v6` call under `/runs/:wf/llm-calls` and pull the raw input/output
5. **Why this ranking**: `detailedMetrics.story_rank` (rounds succeeded, `intersectionSize`, failure reason) and `story_validation` (judge counts: `judgeFailures` / `pocketFlagged` / `unsureClusters`, normally ~0)

**Replaying a run locally**: `pnpm -F @meridian/backend replay <workflowId>` answers with that run's recorded LLM I/O from `llm-calls/` and re-runs the whole workflow locally, diffing the result against production field by field (preconditions and limits in `apps/backend/test/replay/README.md`).

**Logs & traces** (Workers Logs, `observability` block in each `wrangler` config)

- All three Workers (backend, ai-worker, ml `cf-worker`) keep logs **and** traces at `head_sampling_rate = 1`, with invocation logs on. Why no sampling: traffic is tiny and bursty in the wrong places — one brief per day, one DO alarm per source per hour, and a few thousand queue/ai-worker calls a day. Measured 2026-09-19..26 (GraphQL `workersInvocationsAdaptive`): backend 7.3k invocations + 3.0k DO requests, ai-worker 7.9k, ml 0.1k + 0.3k DO — about 80k invocations a month. Spans: ~2.7k invocations/day plus ~2.9k subrequests/day (same query) — at a generous ~10 spans per invocation that is under ~30k spans/day (~0.8M/month). With ~30 log lines per invocation, logs + traces come to ~3M events/month, against 20M included on Workers Paid (overage $0.60/M; the Free-plan cap is 200k/day). A 5% trace rate would drop the daily brief 19 days out of 20. Re-check this if volume grows ~5×.
- Traces are free during the beta; from 2026-10-01 each span counts as one event in the same quota and price as logs. Docs: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [Traces](https://developers.cloudflare.com/workers/observability/traces/), [Pricing](https://developers.cloudflare.com/workers/platform/pricing/#workers-logs).
- Every log line is one flat JSON object. Same keys in backend (`apps/backend/src/lib/core/logger.ts`) and ai-worker (`services/meridian-ai-worker/src/utils/logger.ts`):

| Key | Meaning |
|---|---|
| `level` | `debug` / `info` / `warn` / `error` (also picks the `console` method, so the dashboard level matches) |
| `message` | the human-readable line; the old `[AutoBrief] …` prefixes are kept |
| `timestamp` | ISO time of the log call |
| `service` | Worker name: `meridian-backend` / `meridian-ai-worker` |
| `component` / `router` / `durable_object` / `workflow` | where in the Worker the line came from |
| `workflow_id`, `trace_id`, `source_id`, `request_id` | correlation ids when known (`workflow_id` on every brief-workflow and `WorkflowObservability` line; ai-worker logs `trace_id` once per request on the `[trace]` line) |
| `error` | only when an exception was passed: `{ message, stack?, cause? }`; a plain error string in context goes under `error_message` |
| `detail` | a non-object value that used to be the second `console.log` argument |

  Filter in the dashboard with e.g. `workflow_id = cron-brief-<ts>` or `service = meridian-ai-worker AND level = error`. The ml `cf-worker` does not log anything itself (only the platform's invocation logs); the Python container's own stdout is unchanged.

**Other entry points**: production logs via `wrangler tail` (CF Dashboard → Workers → Logs when a local session won't open); cost and usage via CF GraphQL / Dashboard; `*.workers.dev` gets RST'd from mainland China, use a proxy locally.
