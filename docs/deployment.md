# Deployment

Four deployable units, each deployed from its own directory — **never deploy from the repo root**. Variables for each are documented in that directory's `.dev.vars.example`; production secrets are set with `wrangler secret put`.

The three Workers are deployed with `scripts/deploy.sh`, run from the service directory. It wraps `wrangler deploy` (extra arguments are passed through) and records which commit is being deployed: the short hash, the commit title and whether the working tree is dirty go in as `--var GIT_COMMIT/GIT_TITLE/GIT_DIRTY`, the hash also as the version `--tag`; for the ML Service the same three values become Docker build args (a temporary `wrangler.deploy.jsonc` with `image_vars` filled in). Each service reports them — backend `GET /version`, AI Worker `GET /meridian/version`, ML Service `GET /health` — and the backend collects all three at `GET /observability/ops/services` for the ops console. The script refuses to run from the repo root; `scripts/deploy.sh --print` shows the command without running it. A plain `wrangler deploy` still works, but that service then reports no commit.

Production is deployed only from `main` (`scripts/deploy.sh` refuses a production deploy from any other branch): development and staging happen on `meridian-dev`, which is merged into `main` once verified, so `main` always equals what is running. The frontend goes out with `wrangler pages deploy --branch main` from the repo root after a build.

Deploy in dependency order: DB migration → AI Worker → ML Service → backend → frontend. The backend's service bindings point at `meridian-ai-worker` and `meridian-ml-service`, so backend deploy fails if those aren't live yet.

1. **DB migration** — `pnpm -F @meridian/database migrate` (`DATABASE_URL` from `packages/database/.env.example`). Schema-change flow (`generate` → review SQL → commit together) is in `CLAUDE.md`; files under `packages/database/migrations/` are historical and must not be edited.
2. **AI Worker** (`services/meridian-ai-worker`, `wrangler.toml`)
   ```bash
   cd services/meridian-ai-worker
   ../../scripts/deploy.sh
   ```
   No secrets needed while `BRIEF_CHECK_MODE` is `agent` — every model call goes through the Workers AI binding `AI`; per-phase models live in `src/services/call-llm.ts`'s `PHASE_DEFAULTS`. For `one_call`, set `DASHSCOPE_BASE_URL` in `wrangler.toml` to the AI Gateway's `custom-dashscope` endpoint and put `DASHSCOPE_API_KEY` (and `AI_GATEWAY_TOKEN` if the gateway requires one) with `wrangler secret put`.
3. **ML Service** (`services/meridian-ml-service/cf-worker`) — one deploy is two things: the Durable Object shell (`cf-worker/src/index.ts`) and the container image built from `wrangler.jsonc`'s `"image": "../Dockerfile"` (the clustering/embedding code lives in the image). Needs Docker locally and a populated `services/meridian-ml-service/model-cache/` (gitignored, ~470MB — the Dockerfile `COPY`s it directly).
   ```bash
   cd services/meridian-ml-service/cf-worker
   ../../../scripts/deploy.sh
   ```
   No secrets and no public URL: `workers_dev` and `preview_urls` are off, the only way in is the backend's `ML_SERVICE` service binding.
   **A successful shell deploy does not mean the image was updated** (the clustering algorithm once shipped three and a half months late because of this, 2026-06→09). After deploying, run:
   ```bash
   scripts/check-container-deploy.sh    # 0 = image not older than code; 1 = image stale; 2 = tooling error
   ```
   At runtime the backend asserts the image's `build_identity` on every clustering call (`buildIdentityCheck`; a missing field marks the run `DEGRADED`). `GET /health` is no longer reachable from outside.
4. **Backend** (`apps/backend`, `wrangler.jsonc`)
   ```bash
   cd apps/backend
   wrangler secret put API_TOKEN                     # Bearer token for /admin/* and /observability/*
   ../../scripts/deploy.sh
   ```
   Bindings — see "Configuration" below. Adding a source via `POST /admin/sources` (or the admin UI) starts its DO; `POST /do/admin/initialize-dos` is only a backfill for rows inserted straight into the DB.
5. **Frontend** (Cloudflare Pages) — Pages config is in the repo-root `wrangler.toml` (`pages_build_output_dir = "apps/frontend/dist"`, production vars under `[env.production.vars]`). Pages project `meridian-reader`. Secrets via `wrangler pages secret put` — runtime only reads `NUXT_`-prefixed names: `NUXT_SESSION_PASSWORD`, `NUXT_WORKER_API_TOKEN`, `NUXT_ADMIN_USERNAME`, `NUXT_ADMIN_PASSWORD`. Build: `pnpm -F @meridian/frontend build`. The frontend has no database access — all data comes from the backend (`/reader/*`, `/admin/*`), so deploy the backend first.

**Judging whether a deploy worked**
- `scripts/deploy.sh` (`wrangler deploy` underneath) uploads a version and activates a deployment. **Only trust the `Current Version ID` in the output changing from the previous one** — an `Uploaded` line or a zero exit code don't mean it activated.
- Upload succeeds but activation hangs: usually an OAuth token missing write scope; `wrangler whoami` will warn — `wrangler login` again.
- ML Service also needs to pass `scripts/check-container-deploy.sh`.
- "Deployed" isn't "ran": new brief-generation code only proves itself on a run. For a large feature or an architecture change, do a Staging run before deploying to production (below); small changes go straight to production and are read there.

**Staging** (ADR 0013) — a second copy of the backend and the AI Worker with their own data, for trying a change before production and for debug runs.

| | production | staging |
|---|---|---|
| Workers | `meridian-backend`, `meridian-ai-worker` | `meridian-backend-staging`, `meridian-ai-worker-staging` |
| ML Service | `meridian-ml-service` | the same one (it stores nothing) |
| Postgres | Neon branch `production` | Neon branch `staging`, reset to `production` before each Staging run |
| R2 / queues / workflow names | `…-prod` | their own (`meridian-articles-staging`, `…-queue-staging`, `…_staging`) |
| Cron | daily | none; no scraping either |
| AI Gateway | `meridian-gateway` | `meridian-ai` |
| Frontend | Pages production | Pages preview branch `staging` → `https://staging.meridian-reader.pages.dev` (STAGING banner, `noindex`) |

```bash
# deploy the branch under test (same script, plus --env staging)
cd services/meridian-ai-worker && ../../scripts/deploy.sh --env staging
cd apps/backend               && ../../scripts/deploy.sh --env staging
pnpm -F @meridian/frontend build && wrangler pages deploy --branch staging   # from the repo root

# one Staging run: reset the Neon branch → migrate → copy recent article bodies prod bucket → staging bucket → trigger → wait → verdict
node scripts/staging-run.mjs            # --no-reset keeps the current data (debugging); --attach <run id> picks up a run whose polling got cut off
```

- `scripts/staging-run.mjs` reads `.staging.env` in the repo root (gitignored; template `.staging.env.example`: staging backend URL and token, staging database URL, reader URL, Neon project id, and a Cloudflare account id plus an API token that can read and write R2 objects) and needs `neonctl` and `psql` on the machine. The body copy goes through the Cloudflare REST API, which is rate limited: the first run copies a day or two of articles and can spend several minutes waiting; later runs copy only what is new. Exit code 0 = green or yellow (yellow flags are printed), 1 = red, 3 = timed out. It judges pipeline health only, from the flags the ops console already puts on a run; read the brief itself on the staging reader page.
- A Staging run takes the cron path (`POST /admin/briefs/run-scheduled`, which exists only when `ENVIRONMENT` is `staging`), so it is published on the staging site and shows up in the staging ops console. Manual runs (`POST /admin/briefs/generate`) work on staging too and are not published.
- Each run appends a line to `.staging-verdicts.jsonl` (gitignored, this machine only). `scripts/deploy.sh` reads it when deploying the production backend or AI Worker: if the latest Staging run of the current commit did not pass (or there is none) it prints a one-line note and deploys anyway (expected for small changes, which skip staging).
- Staging secrets are separate: `wrangler secret put API_TOKEN --env staging` (backend; its own value), `DASHSCOPE_API_KEY` and `AI_GATEWAY_TOKEN` with `--env staging` (AI Worker), and the four `NUXT_*` secrets with `wrangler pages secret put … --env preview`.
- `scripts/check-staging-isolation.mjs` (part of `pnpm typecheck`) fails if the staging section of a Worker config reuses a production resource name or id, or gains a cron.
- Don't reset while the production run is in progress (about 21:00–21:40 Beijing time): the reset copies its `RUNNING` row and the staging trigger answers 409 until production finishes and you reset again.
- Not covered by staging: ML Service changes (clustering, embeddings) and changes to the backend ↔ ML Service interface.

**CI**: none. Nothing deploys automatically; every step above is manual.
