# Meridian

新闻聚合系统：RSS 抓取 → 向量化聚类 → LLM 生成 brief。Cloudflare 生态原生。

## Stack
- Monorepo: **pnpm + turbo**, Node ≥22, pnpm 10.9.0
- `apps/backend` — CF Worker (Durable Objects + Workflows + Queue + Hyperdrive)
- `apps/frontend` — Nuxt 3
- `services/meridian-ai-worker` — CF Worker，LLM 只走 Workers AI（`env.AI` binding）：简报链路 `glm-4.7-flash`，文章分析 `qwen3-30b` → `glm-4.7-flash`
- `services/meridian-ml-service` — Python/FastAPI on CF Container（e5-small embedding + 余弦凝聚聚类）
- `packages/database` — Drizzle ORM + Neon Postgres
- `packages/contracts` — 跨 service 约定（ai-worker 路由类型、R2 key、EMBEDDING_DIM），只放约定不放实现

## Commands（根目录）
- `pnpm typecheck` / `pnpm format`
- `pnpm -F @meridian/backend dev` / `@meridian/frontend dev` / `meridian-ai-worker dev`
- `pnpm -F @meridian/database generate` / `migrate` / `studio`
- 部署：进对应 service 目录（`apps/backend`、`services/meridian-ai-worker`、`services/meridian-ml-service/cf-worker`）跑 `scripts/deploy.sh`（包一层 `wrangler deploy`，把提交短哈希、标题、dirty 带上去，运维台靠它显示各服务的版本；`--print` 只打印命令），**永不从 root 部署**——脚本在根目录会拒绝（唯一例外：前端 Pages 的配置就在根目录 `wrangler.toml`，见 README）

## 部署环境
- CF account: `swj299792458`（子域 `swj299792458.workers.dev`）
- DB: Neon `ap-southeast-1`，连接走 Hyperdrive
- AI Gateway：现在没有任何调用经过它（2026-09-24 删掉了最后一个走 Gateway 的 DashScope）。要接非 CF 厂商时经 CF AI Gateway 接入；embedding 走 ml-service
- Secrets：`wrangler secret put` 或 CF Secrets Store，**永不入库**
- 本地 secrets 在每个 worker 的 `.dev.vars`（已 gitignored）

## 工作规则
- 分支：`meridian-dev` 是主干（没有 `main`）。主会话的改动直接提交到当前分支；写代码的 subagent 用 `isolation: "worktree"`，由主会话合回。
  `.claude/settings.json` 设了 `worktree.baseRef: "head"`，工作树从本地 HEAD 建（默认从 `origin` 建，看不到没 push 的提交）；未提交的改动不会带过去，派之前先 commit
- 不主动新建 eval harness。要建，先在真实输出上做过错误分析、拿到修了 prompt / 代码仍残留的失败类别，并经用户同意（为什么见 `docs/adr/0006-eval-bootstrap-and-ruler-recalibration.md`）。错误分析怎么做照 Hamel Husain 的方法：原文 https://hamel.dev/blog/posts/evals-faq/why-is-error-analysis-so-important-in-llm-evals-and-how-is-it-performed.html ，本仓落点 `docs/engineering-notes/eval-playbook.md` §1（仅本地）
- 改 DB schema：编辑 `packages/database/src/schema.ts` → `drizzle-kit generate` → review SQL → 一并 commit
- commit 由 agent 做、push 由用户定：做完一个有意义的工作块（能单独验证、能说清改了什么）就 commit，只提交自己的路径（`git commit -m "…" -- <paths>`，`-m` 要在 `--` 前），不要等用户开口；push 只在用户要求时做。
  `.githooks/pre-commit`（快检查）与 `pre-push`（全仓检查 + 碰到的包的测试）自动跑，没过就按输出修。测试是 golden 快照（只拦「重构改了行为」，不判对错），手动跑：
  `pnpm -F @meridian/backend test`（要本机测试库，见 `apps/backend/test/README.md`「数据库」）、`pnpm -F meridian-ai-worker test`、ml-service 目录下 `.venv/bin/python -m pytest test/`、
  前端端到端 `pnpm -F @meridian/frontend test`（backend 由测试假冒）；整期回放 `pnpm -F @meridian/backend replay <workflowId>`（见 `apps/backend/test/replay/README.md`）。LLM 输出质量靠上线后读真实输出
- 报错先 `wrangler tail`，再加 console.log
- knip `--production` 报「只剩测试 / 本地脚本在用」的导出：真没用就删；只为测试或 `apps/backend/scripts/` 导出的加 `@internal`
- push 会被 Claude Code 的 PreToolUse hook（`.claude/hooks/push-reachability.mjs`）拦下并列出新增的源码文件、路由、binding/配置，按入口可达性复查后跑 `node .claude/hooks/push-reachability.mjs --mark` 再 push

## Agent skills（mattpocock，由 `/setup-matt-pocock-skills` 配置）
- Issue tracker：本地 markdown，spec 与票在 `.scratch/<功能名>/`（gitignored）。见 `docs/agents/issue-tracker.md`
- Triage labels：默认五个角色名。见 `docs/agents/triage-labels.md`
- Domain docs：single-context，根目录 `CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`

## 已知坑
- `services/meridian-ml-service/model-cache/` gitignored，新机器按 `services/meridian-ml-service/README.md`「本地开发」一节手动下载模型文件（470MB）
- `*.workers.dev` 在国内会被 RST，需走代理节点
- **更多 LLM pipeline 踩坑** → 读 `docs/engineering-notes/llm-pipeline-pitfalls.md`（仅本地）

## 何时读哪份 docs
- 开发功能、选流程（matt skills、wayfinder）→ `docs/agents/dev-workflow.md`
- 开工前查旧尝试、一轮 spike / goal 结束做蒸馏 → `docs/agents/knowledge-distillation.md`
- 新增任何文件前（放哪、入不入 git）→ `docs/agents/file-placement.md`
- 链路总览、部署、观测/排错 → 根 `README.md` 的 How It Works / Deployment / Monitoring 三节
- 改 backend / ai-worker 代码 → `.claude/rules/workers.md` 自动载入（本地验证、workflow、观测、LLM 调用的硬规矩）；编排以 `apps/backend/src/workflows/` 代码为准
- 跨 service 调用 → 数据类型、R2 key、embedding 维度在 `packages/contracts/src/`（`@meridian/contracts`，两侧共用一份）；客户端在 `apps/backend/src/lib/services/ai-services.ts`（ai-worker）与 `ml-service.ts`（ML）
- 改算法（聚类/切分/简报合成）→ `docs/adr/0003-cluster-as-brief-block.md`（现行链路与已证伪清单）
- 改写作层（报告 → 正文）/ 治事实关系写错 → `docs/adr/0004-brief-writer-v3.md`（现行流程、证伪清单、检测上限）
- 找调研依据 → `docs/engineering-notes/README.md`（按问题索引）
- 做 eval / 定判据 / 派判官 → `docs/adr/0006-eval-bootstrap-and-ruler-recalibration.md`（硬规矩在 `.claude/rules/eval.md`，改 eval 代码时自动载入；字段与签名的参考在 `eval/cluster-to-brief/CONTRACTS.md`）
- 改运维台（后台的 Health / Trends / Cost / Sources / 运行详情，判据与阈值）→ `docs/adr/0011-ops-console.md`
- 架构决策记录 → `docs/adr/`

## 路径触发的规则（`.claude/rules/`）

按路径自动载入，不占常驻上下文。改到对应目录时才进来。`paths:` 写错不会报错、只会悄悄不载入，
所以 `pnpm typecheck` 先跑 `scripts/check-rules.mjs`：每条 `paths:` 必须匹配到文件，rules 与本文件里反引号写的仓库路径必须存在。

| 文件 | 触发路径 | 内容 |
|---|---|---|
| `eval.md` | `eval/**` | 判据不得带架构假设、sample 是视图、金标四件套与 `targetOf`/`labelBalance`、判官对齐、holdout 卫生 |
| `workers.md` | `apps/backend/**`、`services/meridian-ai-worker/**` | 本地验证（dev 直连生产 R2）、workflow step 规矩、观测、LLM 调用的坑、typecheck 的两个坑 |
| `prototypes.md` | `apps/*/prototypes/**`、`services/*/prototypes/**` | 三个子目录、`.gitignore` 模板、import 生产代码的风险、毕业约定 |

## 禁区（未明确要求不要碰；`.claude/hooks/forbidden-zones.mjs` 碰到时交用户确认）
- `packages/database/migrations/` — 历史 migration 不可变
- `services/meridian-ml-service/model-cache/` — 470MB 模型，gitignored
