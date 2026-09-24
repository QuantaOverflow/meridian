# Meridian 部署指南

四个可部署单元，各在自己的目录里部署，**永不从仓库根目录跑 `wrangler deploy`**。
变量清单以各目录的 `.dev.vars.example` 为准（标 🔐 的在生产用 `wrangler secret put`）。

```
backend ──service binding AI_WORKER──► meridian-ai-worker ──AI binding──► Workers AI
   │
   └──公网 MERIDIAN_ML_SERVICE_URL + X-API-Token──► meridian-ml-service（Worker 壳 + Container）
frontend（Cloudflare Pages）──► Neon Postgres（直连）+ backend API
```

## 部署顺序

依赖在前：DB migration → ai-worker → ml-service → backend → frontend。
backend 的 service binding 指向 `meridian-ai-worker`，它不存在时 backend 部署会失败。

### 1. 数据库 migration

```bash
# DATABASE_URL 见 packages/database/.env.example
pnpm -F @meridian/database migrate
```

改 schema 的流程见 `CLAUDE.md`（`generate` → review SQL → 一并 commit）；`packages/database/migrations/` 里的历史文件不可改。

### 2. AI Worker（`services/meridian-ai-worker`，配置 `wrangler.toml`）

```bash
cd services/meridian-ai-worker
wrangler deploy
```

不需要任何 secret：模型全走 Workers AI binding `AI`，各 phase 的模型在 `src/services/call-llm.ts` 的 `PHASE_DEFAULTS`。

### 3. ML Service（`services/meridian-ml-service/cf-worker`）

一次部署是两件事：`cf-worker/src/index.ts` 的 Durable Object 壳，和 `wrangler.jsonc` 里
`"image": "../Dockerfile"` 构建出的容器镜像（算法全在镜像里）。本机需要 Docker，且
`services/meridian-ml-service/model-cache/`（gitignored，约 470MB）里要有模型文件——Dockerfile 直接 COPY 它。

```bash
cd services/meridian-ml-service/cf-worker
wrangler secret put API_TOKEN     # 须与 backend 的 MERIDIAN_ML_SERVICE_API_KEY 相同
wrangler deploy
```

**壳部署成功不等于镜像已更新**（2026-06 → 09 的聚类算法曾因此三个半月没上线）。部署后跑：

```bash
scripts/check-container-deploy.sh    # 0 = 镜像不比代码旧；1 = 镜像过期；2 = 工具错误
```

线上 `GET /health` 的 `build_identity`（构建时注入的 SHA 与构建时间）也能看镜像是哪次构建的。

### 4. Backend（`apps/backend`，配置 `wrangler.jsonc`）

```bash
cd apps/backend
wrangler secret put API_TOKEN                     # /admin/*、/observability/* 的 Bearer token
wrangler secret put CLOUDFLARE_API_TOKEN          # 浏览器渲染抓取
wrangler secret put MERIDIAN_ML_SERVICE_API_KEY   # = ml-service 的 API_TOKEN
wrangler deploy
```

绑定（都在 `wrangler.jsonc`）：DO `SOURCE_SCRAPER`、`HYPERDRIVE`、队列 `ARTICLE_PROCESSING_QUEUE`、
R2 `ARTICLES_BUCKET`、workflow `PROCESS_ARTICLES` 与 `MY_WORKFLOW`（简报）、service binding `AI_WORKER`、
cron `0 13 * * *`；`MERIDIAN_ML_SERVICE_URL` 是 `vars`。

新加 RSS 源后要初始化它的 DO：`POST /do/admin/initialize-dos`（带 Bearer token）。

### 5. Frontend（Cloudflare Pages）

Pages 配置在仓库根的 `wrangler.toml`（`pages_build_output_dir = "apps/frontend/dist"`，
生产 vars 在 `[env.production.vars]`）。密钥用 `wrangler pages secret put`：
`DATABASE_URL`、`SESSION_PASSWORD`、`WORKER_API_TOKEN`、`ADMIN_PASSWORD`。构建：`pnpm -F @meridian/frontend build`。

## 判断部署成没成

- `wrangler deploy` = 上传 version + 激活 deployment。**只看输出里的 `Current Version ID` 且与上次不同**，
  不看有没有 `Uploaded`、不看退出码
- 上传成功但激活一直 hang：多半是 OAuth token 缺 write scope，`wrangler whoami` 会警告，需重新 `wrangler login`
- ml-service 另外要过 `scripts/check-container-deploy.sh`
- 「已部署」不等于「跑过」：新简报代码要等下一次 cron（或手动 `POST /admin/briefs/generate`）真实跑一期再算上线

## CI

没有 CI，不会自动部署，以上步骤都是手动的。

## 排错

- 生产日志：`wrangler tail`（本机常建不起会话时走 Dashboard → Workers → Logs）
- workflow 实例：`wrangler workflows instances describe`
- 按 run 查观测数据：见 `docs/OBSERVABILITY_GUIDE.md`
- `*.workers.dev` 在国内会被 RST，本机访问需走代理
