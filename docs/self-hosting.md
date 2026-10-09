# Running your own Meridian

How to stand up a copy of Meridian on your own Cloudflare account, starting from nothing. It takes about an hour, most of it waiting for the first container image.

This guide has not been executed end to end on a new account. Each step was checked against the Cloudflare documentation and against the repository's configuration, and the parts that can be simulated locally were (see [What was verified](#what-was-verified)). If a step fails for you, please [open an issue](https://github.com/QuantaOverflow/meridian/issues/new/choose).

## What you need

| | Why |
|---|---|
| A Cloudflare account on the **Workers Paid** plan ($5/month) | Containers, which the ML service runs on, are not available on the free plan |
| A Postgres database with the `vector` extension | [Neon](https://neon.tech) works on its free tier; the first migration runs `CREATE EXTENSION vector` |
| Node 22, pnpm 10, Python 3.11 with [uv](https://github.com/astral-sh/uv) | Build and deploy tooling |
| Docker, running | `wrangler deploy` builds the ML service image on your machine |
| About 1 GB of disk | 470 MB of model files, plus the image |

Usage costs on top of the plan are small: one brief a day is roughly 30,000 Workers AI neurons (about $0.33), plus per-article analysis.

The steps below keep the resource names used in this repository (`meridian-backend`, `meridian-articles-prod` and so on). Worker, bucket and queue names only have to be unique within your account, so you can keep them. Only four values are specific to an account and must be changed; they are listed in step 4.

## 1. Clone and install

```bash
git clone https://github.com/QuantaOverflow/meridian.git
cd meridian
pnpm install
pnpm exec wrangler login
```

Stay on the `main` branch: `scripts/deploy.sh` refuses to deploy to production from any other branch.

## 2. Database

Create a Postgres database and copy its **direct** connection string (on Neon, the one without `-pooler` in the host name).

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require" pnpm -F @meridian/database migrate
```

## 3. Cloudflare resources

```bash
# Object storage for article text and run records
pnpm exec wrangler r2 bucket create meridian-articles-prod

# The article queue and its dead-letter queue
pnpm exec wrangler queues create meridian-article-processing-queue-prod
pnpm exec wrangler queues create meridian-article-processing-dlq

# Hyperdrive in front of the database; note the id it prints
pnpm exec wrangler hyperdrive create meridian-db --connection-string="postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require"

# The Pages project for the reader
pnpm exec wrangler pages project create meridian-reader --production-branch main
```

Durable Objects, Workflows, the Workers AI binding and the Browser Run binding need no setup; they are created or attached when the Workers are deployed.

## 4. The four values to change

| File | Field | Set it to |
|---|---|---|
| `apps/backend/wrangler.jsonc` | top-level `vars.CF_ACCOUNT_ID` | Your account id (`pnpm exec wrangler whoami`) |
| `apps/backend/wrangler.jsonc` | top-level `hyperdrive[0].id` | The id printed by `hyperdrive create` |
| `services/meridian-ai-worker/wrangler.toml` | top-level `BRIEF_CHECK_MODE` | `"agent"` (see below) |
| `wrangler.toml` (repo root) | `[env.production.vars]` `NUXT_PUBLIC_WORKER_API` | `https://meridian-backend.<your-subdomain>.workers.dev` |

Your `workers.dev` subdomain is shown in the Cloudflare dashboard under Workers & Pages; the backend's URL is also printed when you deploy it in step 7, so you can fill the last one in then.

**About `BRIEF_CHECK_MODE`.** The sentence check has two modes. `agent` runs entirely on Workers AI and needs nothing else. `one_call`, the repository's default, sends the check to DashScope through a Cloudflare AI Gateway, and `DASHSCOPE_BASE_URL` in that file points at the author's gateway. Start with `agent`. To use `one_call` later, create your own AI Gateway with a custom provider for DashScope, point `DASHSCOPE_BASE_URL` at it, and add the `DASHSCOPE_API_KEY` secret ([ADR 0012](adr/0012-one-call-sentence-check.md)).

Leave the `env.staging` sections alone. They describe the optional second environment and are not deployed unless you pass `--env staging`.

After editing the backend config, regenerate its types, or `pnpm typecheck` will report that they are out of date:

```bash
pnpm -F @meridian/backend exec wrangler types
```

## 5. AI Worker

```bash
cd services/meridian-ai-worker
../../scripts/deploy.sh
cd ../..
```

No secrets in `agent` mode. A deploy worked when the output ends with a `Current Version ID`.

`scripts/deploy.sh` prints a note that the commit has not passed a staging run. That is expected; ignore it.

## 6. ML service

Download the embedding model into `services/meridian-ml-service/model-cache/` (it is not in the repository; the Dockerfile copies it into the image):

```bash
cd services/meridian-ml-service
uvx --from huggingface_hub hf download intfloat/multilingual-e5-small \
  config.json model.safetensors sentencepiece.bpe.model special_tokens_map.json tokenizer.json tokenizer_config.json \
  --local-dir model-cache
```

Then, with Docker running, deploy from `services/meridian-ml-service/cf-worker`:

```bash
cd cf-worker
../../../scripts/deploy.sh
cd ../../..
```

The first deploy builds and pushes the image and can take several minutes. The service has no public URL; the backend reaches it through a service binding.

## 7. Backend

The backend declares two required secrets, and `wrangler deploy` fails until both exist:

```bash
cd apps/backend
pnpm exec wrangler secret put API_TOKEN            # any long random string; it guards /admin, /reader and /observability
pnpm exec wrangler secret put CF_ANALYTICS_TOKEN   # a Cloudflare API token with "Account Analytics: Read", for the ops console's cost panels
../../scripts/deploy.sh
cd ../..
```

`wrangler secret put` offers to create the Worker if it does not exist yet; accept. Deploy the AI Worker and the ML service first: the backend binds to both by name and its deploy fails if they are missing.

Note the URL in the output and put it in the root `wrangler.toml` if you have not yet (step 4).

## 8. Sources

```bash
MERIDIAN_BACKEND_URL=https://meridian-backend.<your-subdomain>.workers.dev API_TOKEN=<the API_TOKEN from step 7> \
  node scripts/seed-sources.mjs
```

This adds the 14 feeds in [`scripts/sources.json`](../scripts/sources.json) through the admin API, which also starts a scraper for each. Edit that file, or pass your own, to use different feeds. The script can be run again; feeds already present are skipped.

## 9. Reader

```bash
for name in NUXT_SESSION_PASSWORD NUXT_WORKER_API_TOKEN NUXT_ADMIN_USERNAME NUXT_ADMIN_PASSWORD; do
  pnpm exec wrangler pages secret put "$name" --project-name meridian-reader
done
pnpm -F @meridian/frontend build
pnpm exec wrangler pages deploy --branch main
```

| Secret | Value |
|---|---|
| `NUXT_SESSION_PASSWORD` | A random string of at least 32 characters |
| `NUXT_WORKER_API_TOKEN` | The backend's `API_TOKEN` from step 7 |
| `NUXT_ADMIN_USERNAME`, `NUXT_ADMIN_PASSWORD` | Your login for the ops console at `/admin` |

Run the last two commands from the repository root: the Pages configuration is the root `wrangler.toml`.

## 10. The first brief

Nothing appears right away. Scrapers check their feeds within the hour and articles are analysed as they arrive. The brief workflow runs daily at 13:00 UTC and writes about the articles of the last day, so the first brief worth reading comes after the first full day.

- The ops console at `https://<your-pages-domain>/admin` shows sources, ingest and each run.
- Only scheduled runs are published to readers. `POST /admin/briefs/generate` starts a run by hand for debugging, and its brief is not shown on the reader.
- When a run fails, start with [`monitoring.md`](monitoring.md).

## Things that still point at the author's deployment

None of these stop your copy from working.

- `scripts/check-deployed-lag.mjs` (run by the pre-push hook) compares your commits with the author's backend unless you set `MERIDIAN_BACKEND_URL`. It only prints a note.
- `eval/`, `apps/backend/test/replay/` and `scripts/staging-run.mjs` read from the author's production data and need credentials you do not have. The test suites themselves run without them.
- The Open Graph image generated by the backend carries the text `meridian-reader.pages.dev`.

## Optional: a staging environment

A second copy of the backend and the AI Worker with their own database branch, bucket and queues, for trying a change before production. Setting it up means creating those resources, replacing the ids in the `env.staging` sections, and filling in `.staging.env`. See the Staging section of [`deployment.md`](deployment.md) and [ADR 0013](adr/0013-staging-environment.md).

## What was verified

- **On a clean checkout in CI**: `pnpm install --frozen-lockfile`, the full migration chain against an empty Postgres with pgvector, type-check, lint and every test suite.
- **Locally, on a fresh clone with the four values replaced by placeholders**: the backend's types regenerate and type-check, `wrangler deploy --dry-run` builds all three Workers, the reader builds, and the seed script behaves as described against a stand-in backend.
- **Against the Cloudflare documentation**: the required-secrets behaviour, the Containers plan and Docker requirements, and the resource-creation commands.
- **Not verified**: an actual deploy to a second Cloudflare account, and the model download command.

A check in `pnpm typecheck` (`scripts/check-self-hosting.mjs`) fails if a resource, secret or account-specific field in the Wrangler configurations is not mentioned in this guide.
