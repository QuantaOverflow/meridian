# How Meridian works

The pipeline end to end. Design decisions and the alternatives that were tried and dropped are in [`adr/`](adr/).

## Components

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
| `services/meridian-ai-worker` | Every LLM call; Workers AI (`@cf/zai-org/glm-4.7-flash`, mostly) via the `AI` binding. One exception: with `BRIEF_CHECK_MODE=one_call` the sentence check calls DashScope `qwen3.8-flash` through the Cloudflare AI Gateway and falls back to the Workers AI agent when that fails (ADR 0012). Called via service binding `AI_WORKER` |
| `services/meridian-ml-service` | FastAPI on a Cloudflare Container: `multilingual-e5-small` embeddings and agglomerative cosine clustering |
| `apps/frontend` | Nuxt 3 reader (map homepage for the latest issue, brief reading page, archive, story threads; English UI) + admin pages |
| `packages/database` | Drizzle schema and migrations for Neon Postgres |

## Pipeline

### 1. Scraping
- RSS sources live in the `sources` table and are managed via `POST /admin/sources` / `PUT /admin/sources/:id`
- Each source gets its own Durable Object (`SourceScraperDO`) that fetches on its frequency tier and deduplicates via DB constraints
- New article ids are queued for processing

### 2. Article processing (`ProcessArticles` workflow, per queued batch)
- Fetches the article body (`DomainRateLimiter`: concurrency 8, 1s global / 5s per-domain cooldown); every site fetches first and falls back to browser rendering (`used_browser` records which path produced the body, or that both failed); PDFs and blocked/stub pages (junk extraction, player shells) are marked and skipped, not analyzed
- AI Worker `POST /meridian/article/analyze` extracts language, location, quality, event summary points, keywords, entities
- Body goes to R2, metadata and analysis to Postgres
- Embeddings are **not** computed here (since 2026-07) — batch-computed later, right before clustering, so the ML container isn't kept warm by one-at-a-time calls

### 3. Brief generation (`AutoBriefGenerationWorkflow`, cron `0 13 * * *` UTC, one run/day)
1. **Embeddings backfill** — missing embeddings for the window are computed in batches of 50 right before clustering (ML Service `POST /embeddings`)
2. **Clustering** — no dimensionality reduction, cosine-distance average-linkage agglomerative clustering (ML Service `POST /ai-worker/clustering`). One cluster ≈ one event
3. **Cluster judging** — `/meridian/cluster/judge`: one call per cluster decides EVENT / NO_EVENT and names the story. Block importance comes from a source-count formula (`blockImportance`), not an LLM score
4. **Importance ranking** — `/meridian/stories/rank`: three shuffled LLM rounds + Borda aggregation over all candidates, then a per-event cap
5. **Brief blocks, one workflow step per story** — `/meridian/brief-block-v6`: each selected cluster's articles become one block of 3–5 cited sentences (1–2 for the "in brief" tier). The block is produced by a writer–checker loop (ADR 0010): `deepseek-v4-pro` writes a draft; every sentence is then checked against the cluster's source text by a second model, which returns either "fine" or the problem with the source sentences that show it; objections go back into the writer's conversation and it rewrites the whole block; only changed sentences are re-checked, at most two rounds. The check runs in one of two modes set by `BRIEF_CHECK_MODE`: `one_call` (production; code builds an evidence pack by fixed rules and DashScope `qwen3.8-flash` answers in a single call, ADR 0012) or `agent` (a `qwen3.8-27b` agent with search / timeline / read tools; also the fallback when a `one_call` request fails). Any failure publishes the best version so far and records the downgrade; sentences and blocks are never silently dropped. One step per story because ~2% of Workflow step invocations get canceled by the platform; batching many LLM calls into one step would drop a whole run on a single blip
6. **Assembly** — code renders three sections (lead / more / in brief); `/meridian/brief-title`, `/meridian/generate-brief-summary` add the title and reader summary; the report is saved to Postgres

Retired (code deleted, do not look for these): the story-validation layer, candidate grouping, two-stage storyline, the intel-report layer, b′ segmented writing, and whole-brief synthesis + faithfulness gate + RARR — see `docs/adr/0003-cluster-as-brief-block.md` and `docs/adr/0004-brief-writer-v3.md` for why.

### 4. Delivery
- Nuxt 3 reader: today's brief, archive (`/briefs`), cross-day story threads (`/stories`)
- OpenGraph images via `GET /openGraph/default`

## Technology Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Edge**: Cloudflare Workers, Durable Objects, Workflows, Queues, R2, Containers, Workers AI
- **Database**: Neon Postgres (pgvector) via Hyperdrive, Drizzle ORM
- **Backend**: Hono, Zod, Mozilla Readability + linkedom
- **ML**: FastAPI, PyTorch (CPU), `intfloat/multilingual-e5-small`, scikit-learn
- **Frontend**: Nuxt 3, Vue 3, Tailwind CSS v4
- **Testing**: Vitest (golden snapshot tests), pytest, a record/replay test for the full brief workflow
