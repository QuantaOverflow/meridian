# Meridian

**A daily world-news brief that writes itself, with every sentence traceable to its sources.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Meridian reads a fixed set of news feeds, groups articles about the same event, and has an LLM write a few conclusion-first sentences per event. Each sentence carries citations back to the articles it came from and is checked against them before it is published. One brief comes out every day at 13:00 UTC, entirely on Cloudflare's developer platform.

**Live: [meridian-reader.pages.dev](https://meridian-reader.pages.dev)**

<p align="center">
  <a href="https://meridian-reader.pages.dev"><img src="docs/assets/home-map.png" alt="Meridian home page: today's brief placed on a globe, with the top stories beside it" width="900"></a>
</p>

## What you can read

| | |
|---|---|
| **Today on a map** | The latest brief placed on a globe, one dot per country a story is about |
| **The brief** | About 25 short blocks in three tiers, each a few sentences with source citations |
| **Story threads** | An event that keeps developing is followed across briefs, with a dated timeline |
| **Country and name pages** | Every block about a country, or about a person or organisation that most of its coverage mentions |
| **Search** | Full-text search over every published block |
| **Following** | Follow countries, names and threads; kept in the browser, no account |

<p align="center">
  <img src="docs/assets/brief.png" alt="A brief: a table of contents by tier and the first block" width="440">
  <img src="docs/assets/thread.png" alt="A story thread: one event followed across seven briefs" width="440">
</p>

## How it works

```
RSS feeds ─► one Durable Object per feed ─► queue ─► ProcessArticles workflow
                                                       fetch page → extract text → LLM analysis
                                                       text to R2, metadata to Postgres

cron 13:00 UTC ─► AutoBriefGeneration workflow
                    embed → cluster → judge clusters → rank by importance
                    → write one block per cluster, check each sentence against its sources
                    → assemble tiers → title and summary → Postgres

Postgres + R2 ─► backend API ─► Nuxt reader on Cloudflare Pages
```

- **Clustering instead of asking the model what happened.** Articles are embedded with `multilingual-e5-small` and grouped by cosine agglomerative clustering; an LLM only judges whether a cluster is one event and how much it matters.
- **One cluster, one block.** Each block is written from that cluster's articles alone, so a mistake stays inside one block.
- **Write, then check.** Every sentence of a draft is checked against the source text. When a sentence fails, the block goes back to the writer with the evidence and is rewritten.
- **Deterministic assembly.** Tiers, ordering, citations and the final document are put together by code, not by a model.

A typical run turns about 500 articles into 25 blocks in 10 to 30 minutes, for roughly 30,000 Workers AI neurons (about $0.33 at list price, not counting per-article analysis). The full pipeline is described in [`docs/how-it-works.md`](docs/how-it-works.md).

## Stack

| Part | Built with |
|---|---|
| [`apps/backend`](apps/backend) | Cloudflare Workers, Durable Objects, Workflows, Queues, Hono |
| [`services/meridian-ai-worker`](services/meridian-ai-worker) | Every LLM call, on Workers AI |
| [`services/meridian-ml-service`](services/meridian-ml-service) | FastAPI on a Cloudflare Container: embeddings and clustering |
| [`apps/frontend`](apps/frontend) | Nuxt 3 on Cloudflare Pages |
| [`packages/database`](packages/database) | Drizzle ORM, Neon Postgres with pgvector, via Hyperdrive |
| [`packages/contracts`](packages/contracts) | Types and constants shared across services |

## Running it yourself

You need Node 22, pnpm, Python 3.11 with [uv](https://github.com/astral-sh/uv), a Postgres with pgvector, and a Cloudflare account.

```bash
git clone https://github.com/QuantaOverflow/meridian.git
cd meridian
pnpm install
pnpm -F @meridian/database migrate   # needs DATABASE_URL
pnpm -F @meridian/backend dev
```

The rest of the local setup, the tests and each service's HTTP surface are in [`docs/development.md`](docs/development.md); deploying to your own Cloudflare account is in [`docs/deployment.md`](docs/deployment.md).

## Documentation

| | |
|---|---|
| [`docs/how-it-works.md`](docs/how-it-works.md) | The pipeline, step by step |
| [`docs/development.md`](docs/development.md) | Local setup, tests, API reference, configuration |
| [`docs/deployment.md`](docs/deployment.md) | Deploy order, staging, how to tell a deploy worked |
| [`docs/monitoring.md`](docs/monitoring.md) | Where data lands, the ops console, troubleshooting |
| [`docs/adr/`](docs/adr) | Architecture decision records, including what was tried and dropped |
| [`GLOSSARY.md`](GLOSSARY.md) | The project's vocabulary |

The four guides above are in English. The decision records, the glossary and commit messages are in Chinese, the working language of this project; see [`docs/README.md`](docs/README.md) for a map.

## How this repository is developed

Most of the code here was written by coding agents working under written rules and mechanical checks, with a human setting direction and reading the output. The rules are part of the repository: [`CLAUDE.md`](CLAUDE.md), path-scoped rules and hooks in [`.claude/`](.claude), and the workflow notes in [`docs/agents/`](docs/agents). Evaluation harnesses and hand-labelled test sets are in [`eval/`](eval).

`main` is what is running in production; development happens on `meridian-dev`. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Origin

Meridian started from [iliane5/meridian](https://github.com/iliane5/meridian) by Iliane Amadou (MIT). The idea of an AI-written daily intelligence brief and the first Cloudflare Workers scaffold come from that project. Since then the pipeline, the models, the storage layout and the reader have been rewritten here.

## License

[MIT](LICENSE)
