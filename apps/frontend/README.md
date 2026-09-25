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

前端**不连数据库**，所有数据都经 backend（`NUXT_PUBLIC_WORKER_API`，带 `NUXT_WORKER_API_TOKEN`）：

- 读者端 API（`server/api/briefs/*`、`server/api/stories/*`）从 backend 的 `/reader/*` 取数（`server/lib/backend.ts`），
  这里只做展示：正文 markdown 解析成板块 / 条目（`server/lib/briefContent.ts`）、中文日期、「N 天前更新」文案。
  查询、线索状态与升级判定在 backend 的 `src/lib/reader/`。
- 后台 API（`server/api/admin/*`）需要登录会话；源总览与详情转发 backend 的 `GET /admin/sources*`，
  建源、暂停 / 恢复、删源、初始化 DO 转发到 backend 的 `/admin/sources`、`/do/admin/source/:id/*`（`server/lib/sourceActions.ts`）。
- backend 回 404 时前端回 404，其余失败回 502。

## 环境变量

复制 `.env.example` 为 `.env`。`nuxt.config.ts` 的 `runtimeConfig` 在运行时由这些 `NUXT_*` 覆盖：

| 名称 | 用途 |
|---|---|
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
Playwright 驱动浏览器，backend 由测试自己起的 HTTP 服务假冒。**不需要数据库**。只测逻辑与交互；Workers（workerd）才有的问题测不到。

- `reader-api-golden.test.ts`：读接口的响应快照。假 backend 回放 backend 自己的快照（`apps/backend/test/fixtures/reader/__golden__/`，
  由 backend 的 `test/lib/reader.spec.ts` 生成），前端 `/api/*` 的输出与 `test/__golden__/reader-api/` 逐字节比对
  （后者录于前端还直连数据库时，是「搬到 backend 前后不变」的基准）。backend 快照变了，先确认是有意的，再看这里是否跟着变。
- `admin-sources.test.ts`：后台源管理的转发与页面交互。

运行（每个文件先构建一次，约一分钟）：

```bash
pnpm -F @meridian/frontend test
```

浏览器用 `playwright-core` 1.53.2 对应的 Chromium（本机缓存 `~/Library/Caches/ms-playwright/chromium-1179`；新机器 `npx playwright-core@1.53.2 install chromium`）。
