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
daily cron ──► AutoBriefGenerationWorkflow
                 embeddings (ML Service) → clustering (ML Service) → cluster judge →
                 importance ranking → one brief block per cluster (AI Worker) → title / TLDR → Postgres
                                                     │
Frontend (Nuxt 3 on Cloudflare Pages) ◄── Postgres (Neon via Hyperdrive) + R2
```

| Component | Role |
|---|---|
| `apps/backend` | Hono API, Durable Object scrapers, queue consumer, both Workflows, admin / observability routes |
| `services/meridian-ai-worker` | Every LLM call; Workers AI (`@cf/zai-org/glm-4.7-flash`) through Cloudflare AI Gateway. Called via service binding `AI_WORKER` |
| `services/meridian-ml-service` | FastAPI on a Cloudflare Container: `multilingual-e5-small` embeddings and agglomerative cosine clustering |
| `apps/frontend` | Nuxt 3 reader (today's brief, archive, story threads) + admin pages |
| `packages/database` | Drizzle schema and migrations for Neon Postgres |

The full step-by-step pipeline is in [`docs/meridian-workflow-architecture.md`](docs/meridian-workflow-architecture.md); design decisions and falsified alternatives are in [`docs/adr/`](docs/adr/).

## 🔄 How It Works

### 1. Scraping
- RSS sources live in the `sources` table and are managed via `POST /admin/sources` / `PUT /admin/sources/:id`
- Each source gets its own Durable Object (`SourceScraperDO`) that fetches on its frequency tier and deduplicates via DB constraints
- New article ids are queued for processing

### 2. Article processing (`ProcessArticles`)
- Fetches the article body (plain fetch, browser rendering for tricky domains, Mozilla Readability for extraction); PDFs and blocked/stub pages are marked and skipped
- AI Worker `POST /meridian/article/analyze` extracts language, location, quality, event summary points, keywords, entities
- Body goes to R2, metadata and analysis to Postgres

### 3. Brief generation (`AutoBriefGenerationWorkflow`, daily cron)
1. **Embeddings** — missing embeddings are batch-computed right before clustering (ML Service `POST /embeddings`)
2. **Clustering** — no dimensionality reduction, cosine-distance average-linkage clustering (ML Service `POST /ai-worker/clustering`). One cluster ≈ one event
3. **Cluster judging** — `/meridian/cluster/judge`: one call per cluster decides EVENT / NO_EVENT and names the story. Importance comes from a source-count formula (`blockImportance`), not an LLM score
4. **Importance ranking** — `/meridian/stories/rank`: three shuffled LLM rounds + Borda aggregation over all candidates, with a per-event cap
5. **Brief blocks** — `/meridian/brief-block-v6`: each selected cluster's articles become one block of 3–5 cited sentences (1–2 for the "in brief" tier)
6. **Assembly** — code renders three sections (lead / more / in brief); `/meridian/brief-title`, `/meridian/generate-brief-tldr`, `/meridian/generate-brief-summary` add the title and summaries; the report is saved to Postgres

### 4. Delivery
- Nuxt 3 reader: today's brief, archive (`/briefs`), cross-day story threads (`/stories`)
- OpenGraph images via `GET /openGraph/default`

## 🛠️ Technology Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Edge**: Cloudflare Workers, Durable Objects, Workflows, Queues, R2, Containers, AI Gateway, Workers AI
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
- A Cloudflare account (Workers, Workers AI, AI Gateway, R2, Queues, Containers)

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

Deploy each service from its own directory with `wrangler deploy` — never from the repo root. Secrets are set with `wrangler secret put`. See [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md).

## 📊 API Reference

`/admin/*` and `/observability/*` require `Authorization: Bearer $API_TOKEN`.

### Backend
```bash
POST /admin/sources                 # create source
PUT  /admin/sources/:id             # update source
POST /admin/briefs/generate         # trigger a brief workflow
POST /admin/articles/by-ids         # fetch articles by id
POST /admin/articles/process        # re-run article processing
POST /do/admin/initialize-dos       # initialize all scraper DOs
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
POST /meridian/generate-brief-tldr
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

Backend bindings (`apps/backend/wrangler.jsonc`): Durable Object `SOURCE_SCRAPER`, queue `ARTICLE_PROCESSING_QUEUE`, R2 `ARTICLES_BUCKET`, workflows `PROCESS_ARTICLES` and `MY_WORKFLOW` (the brief workflow), service binding `AI_WORKER`, `HYPERDRIVE`.

## 📈 Monitoring & Observability

- Every workflow step is logged to R2 `observability/<workflowId>.json`; raw LLM I/O to `llm-calls/<workflowId>/`
- Query a run via `/observability/runs/:workflowId`, trends via `/observability/trends`
- See [`docs/OBSERVABILITY_GUIDE.md`](docs/OBSERVABILITY_GUIDE.md)

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
