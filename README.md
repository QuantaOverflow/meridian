# Meridian: Your Personal Intelligence Agency

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Presidential-level intelligence briefings, built with AI, tailored for you.**

Meridian turns the daily flood of global news into one concise executive brief. It scrapes RSS sources, groups articles about the same event, and has an LLM write a short, source-cited block per event — all running on Cloudflare's edge platform.

<p align="center">
  <img src="./screenshot.png" alt="Meridian Brief Example" width="700"/>
</p>

## 🌟 Why Meridian Exists

In an era of information overload, decision-makers need clarity, not more noise. Meridian addresses this by:

- **Cutting Through Noise**: Filters hundreds of sources to surface truly important developments
- **Executive Format**: Conclusion-first blocks of a few sentences per event, not a list of headlines
- **Traceable**: Every sentence in a brief block carries a citation back to the source article
- **Ensuring Transparency**: Open-source approach with full visibility into analysis methodology

Built for executives, researchers, analysts, and curious minds who need strategic intelligence without the time investment.

## 🏗️ System Architecture

```
RSS sources ──► SourceScraperDO (one Durable Object per source)
                    │ new article ids
                    ▼
          ARTICLE_PROCESSING_QUEUE ──► ProcessArticles workflow
                                         fetch body → analyze (AI Worker) → body to R2
cron `0 13 * * *` UTC ──► AutoBriefGenerationWorkflow (one brief/day)
                 embeddings backfill → clustering (ML Service) → cluster judging →
                 importance ranking → per-block writing (AI Worker) → tier assembly → title / summary → Postgres
                                                     │
Frontend (Nuxt 3 on Cloudflare Pages) ◄── Postgres (Neon via Hyperdrive) + R2
```

| Component | Role |
|---|---|
| `apps/backend` | Hono API, Durable Object scrapers, queue consumer, both Workflows, admin / observability routes |
| `services/meridian-ai-worker` | Every LLM call; Workers AI (`@cf/zai-org/glm-4.7-flash`, mostly) via the `AI` binding, no AI Gateway. Called via service binding `AI_WORKER` |
| `services/meridian-ml-service` | FastAPI on a Cloudflare Container: `multilingual-e5-small` embeddings and agglomerative cosine clustering |
| `apps/frontend` | Nuxt 3 reader (today's brief, archive, story threads) + admin pages |
| `packages/database` | Drizzle schema and migrations for Neon Postgres |

The step-by-step pipeline is below in "How It Works"; design decisions and falsified alternatives are in [`docs/adr/`](docs/adr/).

## 🔄 How It Works

### 1. Scraping
- RSS sources live in the `sources` table and are managed via `POST /admin/sources` / `PUT /admin/sources/:id`
- Each source gets its own Durable Object (`SourceScraperDO`) that fetches on its frequency tier and deduplicates via DB constraints
- New article ids are queued for processing

### 2. Article processing (`ProcessArticles` workflow, per queued batch)
- Fetches the article body (`DomainRateLimiter`: concurrency 8, 1s global / 5s per-domain cooldown); tricky domains go through browser rendering, others fetch first and degrade; PDFs and blocked/stub pages (junk extraction, player shells) are marked and skipped, not analyzed
- AI Worker `POST /meridian/article/analyze` extracts language, location, quality, event summary points, keywords, entities
- Body goes to R2, metadata and analysis to Postgres
- Embeddings are **not** computed here (since 2026-07) — batch-computed later, right before clustering, so the ML container isn't kept warm by one-at-a-time calls

### 3. Brief generation (`AutoBriefGenerationWorkflow`, cron `0 13 * * *` UTC, one run/day)
1. **Embeddings backfill** — missing embeddings for the window are computed in batches of 50 right before clustering (ML Service `POST /embeddings`)
2. **Clustering** — no dimensionality reduction, cosine-distance average-linkage agglomerative clustering (ML Service `POST /ai-worker/clustering`). One cluster ≈ one event
3. **Cluster judging** — `/meridian/cluster/judge`: one call per cluster decides EVENT / NO_EVENT and names the story. Block importance comes from a source-count formula (`blockImportance`), not an LLM score
4. **Importance ranking** — `/meridian/stories/rank`: three shuffled LLM rounds + Borda aggregation over all candidates, then a per-event cap
5. **Brief blocks, one workflow step per story** — `/meridian/brief-block-v6`: each selected cluster's articles become one block of 3–5 cited sentences (1–2 for the "in brief" tier). One step per story because ~2% of Workflow step invocations get canceled by the platform; batching many LLM calls into one step would drop a whole run on a single blip
6. **Assembly** — code renders three sections (lead / more / in brief); `/meridian/brief-title`, `/meridian/generate-brief-summary` add the title and reader summary; the report is saved to Postgres

Retired (code deleted, do not look for these): the story-validation layer, candidate grouping, two-stage storyline, the intel-report layer, b′ segmented writing, and whole-brief synthesis + faithfulness gate + RARR — see `docs/adr/0003-cluster-as-brief-block.md` and `docs/adr/0004-brief-writer-v3.md` for why.

### 4. Delivery
- Nuxt 3 reader: today's brief, archive (`/briefs`), cross-day story threads (`/stories`)
- OpenGraph images via `GET /openGraph/default`

## 🛠️ Technology Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Edge**: Cloudflare Workers, Durable Objects, Workflows, Queues, R2, Containers, Workers AI
- **Database**: Neon Postgres (pgvector) via Hyperdrive, Drizzle ORM
- **Backend**: Hono, Zod, Mozilla Readability + linkedom
- **ML**: FastAPI, PyTorch (CPU), `intfloat/multilingual-e5-small`, scikit-learn
- **Frontend**: Nuxt 3, Vue 3, Tailwind CSS v4
- **Testing**: Vitest (golden snapshot tests), pytest, a record/replay test for the full brief workflow

## 🚀 Getting Started

### Prerequisites
- Node.js v22+ and pnpm 10.9.0
- Python 3.11 + [uv](https://github.com/astral-sh/uv) (ML service)
- A Postgres with pgvector (production uses Neon)
- A Cloudflare account (Workers, Workers AI, R2, Queues, Containers)

### Local setup

```bash
git clone https://github.com/QuantaOverflow/meridian.git
cd meridian
pnpm install

# Database migrations (needs DATABASE_URL, see packages/database/.env.example)
pnpm -F @meridian/database migrate
```

Secrets: each Worker reads `.dev.vars` (gitignored). Copy the template next to it and fill it in:
`apps/backend/.dev.vars.example`, `services/meridian-ai-worker/.dev.vars.example`,
`services/meridian-ml-service/cf-worker/.dev.vars.example`, `apps/frontend/.env.example`.
The backend reaches Postgres through Hyperdrive; for local dev it uses `localConnectionString` in `apps/backend/wrangler.jsonc`.

```bash
pnpm -F @meridian/backend dev        # backend
pnpm -F meridian-ai-worker dev       # AI worker
pnpm -F @meridian/frontend dev       # frontend
# ML service: see services/meridian-ml-service/README.md
```

Initialize the scraper Durable Objects once:

```bash
curl -X POST -H "Authorization: Bearer $API_TOKEN" \
  http://localhost:8787/do/admin/initialize-dos
```

### Deployment

Four deployable units, each deployed from its own directory — **never `wrangler deploy` from the repo root**. Variables for each are documented in that directory's `.dev.vars.example`; production secrets are set with `wrangler secret put`.

Deploy in dependency order: DB migration → AI Worker → ML Service → backend → frontend. The backend's service binding points at `meridian-ai-worker`, so backend deploy fails if that isn't live yet.

1. **DB migration** — `pnpm -F @meridian/database migrate` (`DATABASE_URL` from `packages/database/.env.example`). Schema-change flow (`generate` → review SQL → commit together) is in `CLAUDE.md`; files under `packages/database/migrations/` are historical and must not be edited.
2. **AI Worker** (`services/meridian-ai-worker`, `wrangler.toml`)
   ```bash
   cd services/meridian-ai-worker
   wrangler deploy
   ```
   No secrets needed — every model call goes through the Workers AI binding `AI`; per-phase models live in `src/services/call-llm.ts`'s `PHASE_DEFAULTS`.
3. **ML Service** (`services/meridian-ml-service/cf-worker`) — one deploy is two things: the Durable Object shell (`cf-worker/src/index.ts`) and the container image built from `wrangler.jsonc`'s `"image": "../Dockerfile"` (the clustering/embedding code lives in the image). Needs Docker locally and a populated `services/meridian-ml-service/model-cache/` (gitignored, ~470MB — the Dockerfile `COPY`s it directly).
   ```bash
   cd services/meridian-ml-service/cf-worker
   wrangler secret put API_TOKEN     # must match backend's MERIDIAN_ML_SERVICE_API_KEY
   wrangler deploy
   ```
   **A successful shell deploy does not mean the image was updated** (the clustering algorithm once shipped three and a half months late because of this, 2026-06→09). After deploying, run:
   ```bash
   scripts/check-container-deploy.sh    # 0 = image not older than code; 1 = image stale; 2 = tooling error
   ```
   Production `GET /health`'s `build_identity` (image build time) also shows which build is live.
4. **Backend** (`apps/backend`, `wrangler.jsonc`)
   ```bash
   cd apps/backend
   wrangler secret put API_TOKEN                     # Bearer token for /admin/* and /observability/*
   wrangler secret put CLOUDFLARE_API_TOKEN          # browser rendering for scraping
   wrangler secret put MERIDIAN_ML_SERVICE_API_KEY   # = ml-service's API_TOKEN
   wrangler deploy
   ```
   Bindings — see "Configuration" below. After adding a new RSS source, initialize its DO: `POST /do/admin/initialize-dos` (Bearer token).
5. **Frontend** (Cloudflare Pages) — Pages config is in the repo-root `wrangler.toml` (`pages_build_output_dir = "apps/frontend/dist"`, production vars under `[env.production.vars]`). Pages project `meridian-reader`. Secrets via `wrangler pages secret put` — runtime only reads `NUXT_`-prefixed names: `NUXT_DATABASE_URL`, `NUXT_SESSION_PASSWORD`, `NUXT_WORKER_API_TOKEN`, `NUXT_ADMIN_USERNAME`, `NUXT_ADMIN_PASSWORD`. Build: `pnpm -F @meridian/frontend build`.

**Judging whether a deploy worked**
- `wrangler deploy` uploads a version and activates a deployment. **Only trust the `Current Version ID` in the output changing from the previous one** — an `Uploaded` line or a zero exit code don't mean it activated.
- Upload succeeds but activation hangs: usually an OAuth token missing write scope; `wrangler whoami` will warn — `wrangler login` again.
- ML Service also needs to pass `scripts/check-container-deploy.sh`.
- "Deployed" isn't "ran": new brief-generation code only proves itself on the next cron run (or a manual `POST /admin/briefs/generate`).

**CI**: none. Nothing deploys automatically; every step above is manual.

## 📊 API Reference

`/admin/*` and `/observability/*` require `Authorization: Bearer $API_TOKEN`.

### Backend
```bash
POST /admin/sources                 # create source
PUT  /admin/sources/:id             # update source
POST /admin/briefs/generate         # trigger a brief workflow
POST /admin/articles/process        # re-run article processing
POST /do/admin/initialize-dos       # initialize scraper DOs for sources not yet initialized
GET  /observability/runs/:workflowId   # one run: status, stories, step metrics
GET  /observability/health/summary     # recent runs and 24h article stats
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

## 🔧 Configuration

The `.dev.vars.example` files listed above are the source of truth for each Worker's variables. Key ones:

- **Backend**: `API_TOKEN`, `CLOUDFLARE_API_TOKEN` (browser rendering), `MERIDIAN_ML_SERVICE_API_KEY` (must equal the ML service's `API_TOKEN`), `MERIDIAN_ML_SERVICE_URL` (var in `wrangler.jsonc`)
- **AI Worker**: 无 secret（模型走 Workers AI binding）
- **ML Service**: `API_TOKEN`

Backend bindings (`apps/backend/wrangler.jsonc`): Durable Object `SOURCE_SCRAPER`, queue `ARTICLE_PROCESSING_QUEUE`, R2 `ARTICLES_BUCKET`, workflows `PROCESS_ARTICLES` and `MY_WORKFLOW` (the brief workflow), service binding `AI_WORKER`, `HYPERDRIVE`, cron `0 13 * * *`; `MERIDIAN_ML_SERVICE_URL` is a `vars` entry.

## 📈 Monitoring & Observability

Runbook for figuring out what went wrong with a given brief run. Recording code: `apps/backend/src/lib/observability/index.ts` and `auto-brief-generation.ts`; query code: `apps/backend/src/routers/observability.ts`. Everything keys on `workflow_id` (cron runs look like `cron-brief-<ts>`).

**Where data lands**

| Location | Content | Written by |
|---|---|---|
| DB `brief_runs` | one row per run: status (`RUNNING` / `COMPLETED` / `DEGRADED` / `FAILED` / `TERMINATED_NO_STORIES`), per-phase counts, `error` | the workflow's `persist:brief_run_*` steps |
| DB `brief_stories` | one row per candidate block: title, importance, article ids, whether it was selected (`selected_for_intel`) | `persist:brief_stories_and_rejections` |
| DB `reports` | the finished brief | the save-brief step |
| R2 `observability/<workflowId>.json` | `summary` + `detailedMetrics`, rewritten on every step (readable even if the run crashes mid-way) | `WorkflowObservability` |
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
| `GET /observability/trends?days=14` | daily run outcomes and story metrics (1–90 days) |
| `GET /observability/health/summary` | recent runs, last brief, 24h article stats |

R2 objects with no endpoint (article-journey, brief-v3) need `wrangler r2 object get meridian-articles-prod/<key> --remote`.

**Common troubleshooting paths**

1. **A brief didn't come out / errored**: `/health/summary` to find the run → `/runs/:wf` for `run.status` and any `detailedMetrics` step with `status === 'failed'` and its `error`; cross-check `wrangler workflows instances describe` for platform-level state
2. **Status is `DEGRADED`**: three triggers (`degradedReasons`, Workers logs only, not in the DB): ≥1 failed block; a cluster NO_EVENT rate above 15% (normally 2–3%); or the ML Service image identity check failing (`missing` = an old image without `build_identity` — also recorded as `buildIdentityCheck` in `observability/clustering/<wf>.json`). Check `detailedMetrics.brief_blocks` / `story_validation`. A high NO_EVENT rate usually means a stale ML Service image too
3. **Why didn't a big story make the brief**: look up the article in article-journey to see which gate stopped it; a selected-but-missing block shows up as `ok:false` in the brief-v3 record
4. **A block reads wrong**: find its `brief_block_v6` call under `/runs/:wf/llm-calls` and pull the raw input/output
5. **Why this ranking**: `detailedMetrics.story_rank` (rounds succeeded, `intersectionSize`, failure reason) and `story_validation` (judge counts: `judgeFailures` / `pocketFlagged` / `unsureClusters`, normally ~0)

**Replaying a run locally**: `pnpm -F @meridian/backend replay <workflowId>` answers with that run's recorded LLM I/O from `llm-calls/` and re-runs the whole workflow locally, diffing the result against production field by field (preconditions and limits in `apps/backend/test/replay/README.md`).

**Other entry points**: production logs via `wrangler tail` (CF Dashboard → Workers → Logs when a local session won't open); cost and usage via CF GraphQL / Dashboard; `*.workers.dev` gets RST'd from mainland China, use a proxy locally.

## 🧪 Testing

```bash
pnpm typecheck                              # all packages
pnpm -F @meridian/backend test              # backend golden snapshots + unit tests
pnpm -F meridian-ai-worker test             # AI worker golden snapshots + unit tests
cd services/meridian-ml-service && .venv/bin/python -m pytest test/   # clustering golden test
pnpm -F @meridian/backend replay <workflowId>   # replay a production run with recorded LLM output
```

Golden tests freeze current behavior (they catch unintended changes, not wrong answers). LLM output quality is measured by the harnesses under `eval/`.

## 🎯 Current Status & Roadmap

Progress, open decisions and next steps live in [`docs/ROADMAP.md`](docs/ROADMAP.md); technical debt in [`docs/debt.md`](docs/debt.md).


## 🤖 AI Collaboration

This project represents a significant collaboration between human engineering and artificial intelligence:

### **AI Development Partners**

*(Historical: earlier versions ran on Gemini; the production pipeline now runs on Workers AI.)*

- **Claude 3.5 Sonnet**: Architecture design, code generation, prompt refinement, and engineering oversight
- **Gemini 2.0 Flash**: The production workhorse enabling economically viable large-scale analysis
- **Gemini 2.5 Pro**: Long-context analysis, codebase review, and analytical tone development

### **AI Impact**
The AI collaboration wasn't just about productivity—it fundamentally enabled the project's existence. No human team could economically process 2000+ daily articles and analyze 100+ story clusters at the scale and cost efficiency that Meridian achieves. This represents a new paradigm where AI isn't just assisting human work, but enabling entirely new categories of applications that were previously impossible.

## 🤝 Contributing

1. **Fork the Repository**: Create your own copy of the codebase
2. **Create Feature Branch**: `git checkout -b feature/amazing-feature`
3. **Make Changes**: Implement your feature with appropriate tests
4. **Test Thoroughly**: Ensure all tests pass and functionality works
5. **Submit Pull Request**: Provide clear description of changes and benefits

### **Development Guidelines**
- Follow TypeScript strict mode requirements
- Write comprehensive tests for new functionality
- Update documentation for API changes
- Follow established code style and patterns
- Consider performance and security implications

## 📄 License

MIT License - See [LICENSE](./LICENSE) file for complete details.

## 🆘 Support & Community

- **Documentation**: [`docs/`](docs/) and each package's README
- **Issues**: GitHub Issues for bug reports and feature requests
- **Discussions**: GitHub Discussions for community questions

---

**Meridian: Because we live in an age of magic, and we should use it wisely.**

*Transform information overload into strategic intelligence. Built for those who need to understand what matters, when it matters.*
