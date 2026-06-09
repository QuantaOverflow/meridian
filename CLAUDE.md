# Meridian

新闻聚合系统：RSS 抓取 → 向量化聚类 → LLM 生成 brief。Cloudflare 生态原生。

## Stack
- Monorepo: **pnpm + turbo**, Node ≥22, pnpm 10.9.0
- `apps/backend` — CF Worker (Durable Objects + Workflows + Queue + Hyperdrive)
- `apps/frontend` — Nuxt 3
- `services/meridian-ai-worker` — CF Worker，LLM 路由经 AI Gateway (Qwen/DashScope)
- `services/meridian-ml-service` — Python/FastAPI on CF Container (HDBSCAN + e5-small)
- `packages/database` — Drizzle ORM + Neon Postgres

## Commands（根目录）
- `pnpm typecheck` / `pnpm format`
- `pnpm -F meridian-backend dev` / `meridian-frontend dev` / `meridian-ai-worker dev`
- `pnpm -F @meridian/database generate` / `migrate` / `studio`
- 部署：进对应 service 目录跑 `wrangler deploy`，**永不从 root 部署**

## 部署环境
- CF account: `swj299792458`（子域 `swj299792458.workers.dev`）
- DB: Neon `ap-southeast-1`，连接走 Hyperdrive
- AI Gateway: `meridian-gateway`——所有 LLM / embedding 流量走这里
- Secrets：`wrangler secret put` 或 CF Secrets Store，**永不入库**
- 本地 secrets 在每个 worker 的 `.dev.vars`（已 gitignored）

## 工作规则
- 分支：`meridian-dev` 是主干（没有 `main`）
- 改 DB schema：编辑 `packages/database/src/schema.ts` → `drizzle-kit generate` → review SQL → 一并 commit
- 改 LLM prompt：编辑 `services/meridian-ai-worker/src/prompts/` → 跑 `scripts/eval/` 评估 → 再合
- 完成前跑 `pnpm typecheck`；项目暂无单元测试，"完成"以 typecheck + 手动验证为准
- 报错先 `wrangler tail`，再加 console.log

## 本地验证方法（不需要部署）

**验证 ai-worker 单个端点**（最常用，覆盖 90% 场景）：
```bash
# Terminal 1：启动 ai-worker（secrets 从 .dev.vars 读，LLM 走真实 DashScope 会计费）
cd services/meridian-ai-worker && pnpm wrangler dev --port 8787

# Terminal 2：curl 打端点
curl -s -X POST http://localhost:8787/meridian/<endpoint> \
  -H "Content-Type: application/json" \
  -d '{ ... }' | jq .
```
- 不需要 backend，可以单独测 ai-worker 任何端点
- 启动时 wrangler 会打印 `Your worker has access to the following bindings`，确认 bindings 已连接

**backend + ai-worker 联调**（测 service binding 调用链）：
```bash
# 必须用单命令多 -c，两个分开的 wrangler dev 进程不会自动互连
# 第一个 config = primary（暴露 HTTP），后续 = auxiliary（只通过 service binding 被调用）
pnpm wrangler dev \
  -c apps/backend/wrangler.toml \
  -c services/meridian-ai-worker/wrangler.toml
# backend 监听 8787（默认），ai-worker 作为 service binding 在内部解析
```

**R2 注意事项**：
- 本地 `wrangler dev` 默认用**本地模拟 R2**（非真实 bucket），写入的对象只在本次进程存在
- 如需读取生产 R2 里的真实 intel report，在 wrangler.toml 的 r2_buckets 加 `remote = true`
- Workflow 测试通常需要真实 R2（因为 intel report 由上一 step 写入），建议用 `--remote` 模式或 `remote = true`

**Workflow 本地触发**：
```bash
# wrangler dev 跑起来后，通过 HTTP 触发 workflow（见 backend admin 路由）
curl -X POST http://localhost:8787/admin/trigger-brief ...
# 或用 wrangler workflows 命令查看实例
wrangler workflows instances list <WORKFLOW_NAME>
```

**原则：typecheck 通过 + 本地 curl 验证 = 可以 commit；部署只在功能确认后做。**

## 已知坑
- **CF Workflow 单 step 输出 ~1MB 上限**——曾因情报 step 内联返回全部 story 报告而触发 `WorkflowInternalError`（当时靠 `maxStoriesToGenerate=3` 规避）。**已解决（2026-06）**：情报报告卸载 R2、step 只回传 keys（`auto-brief-generation.ts`），现 `maxStoriesToGenerate=15` 安全。新增 step 若要传大对象，沿用"卸 R2 + 传 key"模式
- `services/meridian-ml-service/model-cache/` gitignored，新机器需先 `bash download.sh` 拉模型（470MB）
- `*.workers.dev` 在国内会被 RST，需走代理节点
- 调试三件套：`wrangler tail` / `wrangler workflows instances describe` / R2 `observability/*.json`
- **更多 LLM pipeline 踩坑** → 读 `docs/engineering-notes/llm-pipeline-pitfalls.md`

## 何时读哪份 docs
- 改工作流编排 → `docs/meridian-workflow-architecture.md`
- 跨 service 调用 → `docs/worker-communication.md`
- 部署前 → `docs/DEPLOYMENT_GUIDE.md`
- 观测/排错 → `docs/OBSERVABILITY_GUIDE.md`
- 改算法（聚类/重要性/简报合成）→ `docs/3_智能简报算法合理性与优化分析报告.md`

## 禁区（未明确要求不要碰）
- `packages/database/drizzle/` — 历史 migration 不可变
- `services/meridian-ml-service/model-cache/` — 470MB 模型，gitignored
- `apps/backend/src/tests/` — gitignored
