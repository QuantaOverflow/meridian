# Development

Local setup, tests, the HTTP surface of each service and its configuration. Deploying is in [`deployment.md`](deployment.md).

## Local setup

### Prerequisites
- Node.js v22+ and pnpm 10.9.0
- Python 3.11 + [uv](https://github.com/astral-sh/uv) (ML service)
- A Postgres with pgvector (production uses Neon)
- A Cloudflare account (Workers, Workers AI, R2, Queues, Containers)

### Install and run

```bash
git clone https://github.com/QuantaOverflow/meridian.git
cd meridian
pnpm install

# Database migrations (needs DATABASE_URL, see packages/database/.env.example)
pnpm -F @meridian/database migrate
```

Secrets: each Worker reads `.dev.vars` (gitignored). Copy the template next to it and fill it in:
`apps/backend/.dev.vars.example`, `services/meridian-ai-worker/.dev.vars.example`, `apps/frontend/.env.example`
(the ML service needs no secrets).
The backend reaches Postgres through Hyperdrive; for local dev it uses `localConnectionString` in `apps/backend/wrangler.jsonc`.

```bash
pnpm -F @meridian/backend dev        # backend
pnpm -F meridian-ai-worker dev       # AI worker
pnpm -F @meridian/frontend dev       # frontend
# ML service: see services/meridian-ml-service/README.md — the backend reaches it through the
# ML_SERVICE binding; locally add `-c services/meridian-ml-service/dev-shim/wrangler.jsonc`
```

Sources created via `POST /admin/sources` start their scraper Durable Object right away. Sources inserted straight into the DB (e.g. `pnpm -F @meridian/database seed`, which adds a single feed for local work) need a one-time backfill:

```bash
curl -X POST -H "Authorization: Bearer $API_TOKEN" \
  http://localhost:8787/do/admin/initialize-dos
```

## Testing

```bash
pnpm typecheck                              # all packages
pnpm -F @meridian/backend test              # backend golden snapshots + unit tests
pnpm -F meridian-ai-worker test             # AI worker golden snapshots + unit tests
cd services/meridian-ml-service && .venv/bin/python -m pytest test/   # clustering golden test
pnpm -F @meridian/backend replay <workflowId>   # replay a production run with recorded LLM output
```

Golden tests freeze current behavior (they catch unintended changes, not wrong answers). LLM output quality is measured by the harnesses under `eval/`.

## API Reference

`/admin/*` and `/observability/*` require `Authorization: Bearer $API_TOKEN`.

### Backend
```bash
POST /admin/sources                 # create source and start its DO
PUT  /admin/sources/:id             # update source (url / tier change re-syncs its DO)
POST /admin/briefs/generate         # trigger a brief workflow
POST /admin/articles/process        # re-run article processing
POST /do/admin/initialize-dos       # backfill: initialize scraper DOs for sources not yet initialized
POST /do/admin/source/:id/pause     # stop auto-scraping a source (source and articles kept; skipped by initialize-dos)
POST /do/admin/source/:id/resume    # clear the pause and re-initialize its DO
GET  /observability/runs/:workflowId   # one run: status, stories, step metrics
GET  /observability/ops/health         # ops console: today's run, ingest, services, sources, spend (the admin UI reads this)
```

### AI Worker
```bash
POST /meridian/article/analyze
POST /meridian/cluster/judge
POST /meridian/stories/rank
POST /meridian/brief-block-v6
POST /meridian/brief-title
POST /meridian/generate-brief-summary
```

### ML Service
```bash
GET  /health
POST /embeddings
POST /ai-worker/clustering
```

The route tables in `apps/backend/src/app.ts` + `src/routers/`, `services/meridian-ai-worker/src/index.ts` and `services/meridian-ml-service/src/main.py` are authoritative.

## Configuration

The `.dev.vars.example` files listed above are the source of truth for each Worker's variables. Key ones:

- **Backend**: `API_TOKEN`
- **AI Worker**: `agent` 模式无 secret（模型走 Workers AI binding）；逐句核查配成 `one_call` 时要 `DASHSCOPE_API_KEY`，网关开了鉴权再加 `AI_GATEWAY_TOKEN`
- **ML Service**: 无 secret（只能经 backend 的 `ML_SERVICE` binding 调到）

Backend bindings (`apps/backend/wrangler.jsonc`): Durable Object `SOURCE_SCRAPER`, queue `ARTICLE_PROCESSING_QUEUE`, R2 `ARTICLES_BUCKET`, workflows `PROCESS_ARTICLES` and `AUTO_BRIEF` (the brief workflow), service bindings `AI_WORKER` and `ML_SERVICE`, Browser Run `BROWSER` (scraping fallback; `remote: true`, so local dev uses real Browser Run), `HYPERDRIVE`, cron `0 13 * * *`.
