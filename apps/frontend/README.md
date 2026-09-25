# @meridian/frontend

Meridian 的读者端与源管理后台。Nuxt 3（`srcDir: src`）+ Tailwind CSS v4，Nitro preset `cloudflare-pages`，
生产部署在 Cloudflare Pages（`meridian-reader.pages.dev`）。

## 页面（`src/pages/`）

| 路径 | 内容 |
|---|---|
| `/` | 最新一期简报 |
| `/briefs`、`/briefs/[slug]` | 简报归档与单期 |
| `/stories`、`/stories/[id]` | 跨期故事线索 |
| `/admin/login`、`/admin`、`/admin/feed/[id]` | 源管理后台（`nuxt-auth-utils` 会话登录） |

## 数据从哪来（`src/server/`）

- 读者端 API（`server/api/briefs/*`、`server/api/stories/*`）经 `@meridian/database` **直连 Postgres** 读取，不经过 backend。
- 后台 API（`server/api/admin/*`）需要登录会话；增、查源直接写库，初始化 / 删除源的 DO 转发到 backend 的
  `/do/admin/source/:id/init`、`DELETE /do/admin/source/:id`（带 `NUXT_WORKER_API_TOKEN`）。
  新增源时**不会**自动初始化 DO，要在源详情页手动初始化。

## 环境变量

复制 `.env.example` 为 `.env`。`nuxt.config.ts` 的 `runtimeConfig` 在运行时由这些 `NUXT_*` 覆盖：

| 名称 | 用途 |
|---|---|
| `NUXT_DATABASE_URL` | Postgres 连接串 |
| `NUXT_PUBLIC_WORKER_API` | backend 地址，默认 `http://localhost:8787` |
| `NUXT_WORKER_API_TOKEN` | 调 backend 的 Bearer token，等于 backend 的 `API_TOKEN` |
| `NUXT_ADMIN_USERNAME`、`NUXT_ADMIN_PASSWORD` | 后台登录账号 |
| `NUXT_SESSION_PASSWORD` | 会话加密密钥，至少 32 字符 |

## 命令

```bash
pnpm -F @meridian/frontend dev         # http://localhost:3000
pnpm -F @meridian/frontend build       # Nitro cloudflare-pages 产物
pnpm -F @meridian/frontend preview
pnpm -F @meridian/frontend typecheck   # nuxt typecheck
```

`nuxt.config.ts` 只在生产开 HTTP 缓存；本地 dev 下数据改动立即可见。

## 测试

端到端测试（`test/*.test.ts`）：`@nuxt/test-utils` 真实构建并启动服务（测试里改用 `node-server` preset），
Playwright 驱动浏览器，backend 由测试自己起的 HTTP 服务假冒，数据库用**本机**测试库（测试会清空 `sources`，
非 localhost 的地址直接拒绝）。只测逻辑与交互；Workers（workerd）才有的问题测不到。

一次性准备测试库（本机 Postgres，需 pgvector；不要先手动建 `vector` 扩展，第一个 migration 会建）：

```bash
createdb meridian_frontend_test
DATABASE_URL=postgresql://<user>:<pw>@localhost:5432/meridian_frontend_test pnpm -F @meridian/database migrate
```

运行（每个文件先构建一次，约一分钟）：

```bash
FRONTEND_TEST_DATABASE_URL=postgresql://<user>:<pw>@localhost:5432/meridian_frontend_test pnpm -F @meridian/frontend test
```

改了 schema 之后要对测试库重跑 migrate。浏览器用 `playwright-core` 1.53.2 对应的 Chromium（本机缓存 `~/Library/Caches/ms-playwright/chromium-1179`；新机器 `npx playwright-core@1.53.2 install chromium`）。
