# Meridian

新闻聚合系统：RSS 抓取 → 向量化聚类 → LLM 生成 brief。Cloudflare 生态原生。

## Stack
- Monorepo: **pnpm + turbo**, Node ≥22, pnpm 10.9.0
- `apps/backend` — CF Worker (Durable Objects + Workflows + Queue + Hyperdrive)
- `apps/frontend` — Nuxt 3
- `services/meridian-ai-worker` — CF Worker，LLM 只走 Workers AI（`env.AI` binding）：简报链路 `glm-4.7-flash`，文章分析 `qwen3-30b` → `glm-4.7-flash`
- `services/meridian-ml-service` — Python/FastAPI on CF Container（e5-small embedding + 余弦凝聚聚类）
- `packages/database` — Drizzle ORM + Neon Postgres

## Commands（根目录）
- `pnpm typecheck` / `pnpm format`
- `pnpm -F @meridian/backend dev` / `@meridian/frontend dev` / `meridian-ai-worker dev`
- `pnpm -F @meridian/database generate` / `migrate` / `studio`
- 部署：进对应 service 目录跑 `wrangler deploy`，**永不从 root 部署**（唯一例外：前端 Pages 的配置就在根目录 `wrangler.toml`，见 README）

## 部署环境
- CF account: `swj299792458`（子域 `swj299792458.workers.dev`）
- DB: Neon `ap-southeast-1`，连接走 Hyperdrive
- AI Gateway：现在没有任何调用经过它（2026-09-24 删掉了最后一个走 Gateway 的 DashScope）。要接非 CF 厂商时经 CF AI Gateway 接入；embedding 走 ml-service
- Secrets：`wrangler secret put` 或 CF Secrets Store，**永不入库**
- 本地 secrets 在每个 worker 的 `.dev.vars`（已 gitignored）

## 工作规则
- 分支：`meridian-dev` 是主干（没有 `main`）
- 改 DB schema：编辑 `packages/database/src/schema.ts` → `drizzle-kit generate` → review SQL → 一并 commit
- 完成前跑 `pnpm typecheck` + 相关测试。测试是 golden 快照（只拦「重构改了行为」，不判对错）：
  `pnpm -F @meridian/backend test`（要本机测试库，见 `apps/backend/test/README.md`「数据库」）、`pnpm -F meridian-ai-worker test`、ml-service 目录下 `.venv/bin/python -m pytest test/`、
  前端端到端 `pnpm -F @meridian/frontend test`（要本机测试库，见 `apps/frontend/README.md`「测试」）；
  整期回放 `pnpm -F @meridian/backend replay <workflowId>`（见 `apps/backend/test/replay/README.md`）。LLM 输出质量仍靠 eval + 手动验证
- 报错先 `wrangler tail`，再加 console.log

## 已知坑
- `services/meridian-ml-service/model-cache/` gitignored，新机器按 `services/meridian-ml-service/README.md`「本地开发」一节手动下载模型文件（470MB）
- `*.workers.dev` 在国内会被 RST，需走代理节点
- **更多 LLM pipeline 踩坑** → 读 `docs/engineering-notes/llm-pipeline-pitfalls.md`（仅本地）

## 何时读哪份 docs
- 链路总览、部署、观测/排错 → 根 `README.md` 的 How It Works / Deployment / Monitoring 三节
- 改 backend / ai-worker 代码 → `.claude/rules/workers.md` 自动载入（本地验证、workflow、观测、LLM 调用的硬规矩）；编排以 `apps/backend/src/workflows/` 代码为准
- 跨 service 调用 → `apps/backend/src/lib/services/ai-services.ts`（客户端方法即契约，比文档准）
- 改算法（聚类/切分/简报合成）→ `docs/adr/0003-cluster-as-brief-block.md`（现行链路与已证伪清单）
- 改写作层（报告 → 正文）/ 治事实关系写错 → `docs/adr/0004-brief-writer-v3.md`（现行流程、证伪清单、检测上限）
- 找调研依据 → `docs/engineering-notes/README.md`（按问题索引）
- 做 eval / 定判据 / 派判官 → `docs/adr/0006-eval-bootstrap-and-ruler-recalibration.md`（硬规矩在 `.claude/rules/eval.md`，改 eval 代码时自动载入；字段与签名的参考在 `eval/cluster-to-brief/CONTRACTS.md`）
- 架构决策记录 → `docs/adr/`

## 知识蒸馏（每个 spike / goal 结束时做）

> **开工前先查本地知识库 `docs/knowledge/`**（不入 git，没有就跳过）：说清本轮相对旧尝试的变化、
> 为什么可能绕过失败、希望获得的唯一新信息。不要把相同机制换措辞当新架构。
> 什么时候查/写/整理、记录格式，都以本地 `docs/knowledge/README.md` 为准。
> 搜索必须显式带路径 `docs/knowledge/`：该目录已被 gitignore，不带路径的 ripgrep 类搜索（含内置 Grep 工具）会静默漏掉它。
>
> **GOAL 节点只在我主动提起时才写。** 不要提议"要不要起个 GOAL"——它不产生任何新信息，
> 拿它当下一步动作只是用仪式占掉真正该做的事。上面那三个问题照答，但答在对话里，不是先立节点。

调研笔记、原型（2026-09-12 定）和探索记录卡片（2026-09-24 定）都只留本地、不入 git，所以**要让别人看得到的结论必须蒸馏进入库的文档**：
- 探索记录（一次尝试或一个结论一条，JSON frontmatter + 正文）→ `docs/knowledge/nodes/`（**只留本地**，开发时检索用），详细产物用 `source` 指过去
- 新决定、证伪路线、实测上限 → 对应的 `docs/adr/`（没有就新开一份）
- 新形成的术语 → `CONTEXT.md`
- 进度与下一步 → `docs/ROADMAP.md`
- 新调研笔记在本地 `docs/engineering-notes/README.md` 补一行索引；原型结论写进它自己的 README（本地）

## 新文件放哪（落位规则）

> 定这套是为了不再"边整理边有人新增"追移动靶：新增文件先对照本表，产物靠 .gitignore
> 自动归位，不靠人记得别 `git add`。

| 新增什么 | 放哪 | 入 git |
|---|---|---|
| 产品代码 | `<package>/src/` | ✅ |
| 单元/集成测试 | `<package>/test/`（跟包走，**不设顶层 tests/**——monorepo 惯例） | ✅ |
| eval harness（脚本） | `eval/<domain>/`（`.ts` / `.mjs` + `*.md`） | ✅ |
| 人工标注金标（标签 + 证据 + rubric + manifest） | `eval/_data/<set>/`，跑 `node eval/_data/check.mjs` 校验 | ✅ |
| eval 中间产物（worklist / packet / dump） | 留 `eval/<domain>/`，由该目录 `.gitignore` 挡 | ❌ |
| eval 运行报告 | 该 harness 目录下的 `out/`（`.gitignore` 已挡） | ❌ |
| 原型 / 探索实验（含 fixtures 与产物） | `<package>/prototypes/<name>/`，**必带 `.gitignore`** | ❌ 只留本地（根 `.gitignore` 整目录挡） |
| 一次性探测脚本 / 临时输出 | scratchpad，不进 repo | ❌ |
| 调研笔记（业界/学界调研、原始实测记录） | `docs/engineering-notes/`，按问题索引在其 `README.md` | ❌ 只留本地（根 `.gitignore` 挡） |
| 探索记录卡片 | `docs/knowledge/nodes/` | ❌ 只留本地（根 `.gitignore` 挡） |
| 决定与证伪清单 | `docs/adr/` | ✅ |
| 术语表 | `CONTEXT.md` | ✅ |
| 链路总览、部署、观测排错（给人读） | 根 `README.md` | ✅ |
| 写代码时的硬规矩（给 agent） | `.claude/rules/<topic>.md`，`paths:` 写到包一级 | ✅ |
| 路线图、技术债 | `docs/ROADMAP.md`、`docs/debt.md` | ✅ |
| 设计交付稿（design handoff） | `docs/design/<name>/`；前端实现后以代码为准 | ❌ 只留本地（根 `.gitignore` 挡） |
| session 交接记录（`*-handoff.md`） | 工作流水账，不入库（`.gitignore` 挡 `docs/*-handoff.md`） | ❌ |
| 密钥 | `.dev.vars`（gitignore），只提交 `.dev.vars.example` | 仅模板✅ |

**判据一句话**：能让别人**复现或验证**的（代码/测试/金标/说明书/输入 fixtures）→ 入 git；
某次运行的**产物**或某次交接的**流水账**（dump/report/handoff/临时脚本）→ 不入。

原型与 eval harness 都是 pnpm workspace 成员，各目录只留 `package.json`，
根目录 `pnpm install` 一次装完。原型的目录结构、`.gitignore` 模板与「毕业」约定见
`.claude/rules/prototypes.md`（改原型时自动载入）。

## 路径触发的规则（`.claude/rules/`）

按路径自动载入，不占常驻上下文。改到对应目录时才进来。`paths:` 写错不会报错、只会悄悄不载入，
所以 `pnpm typecheck` 先跑 `scripts/check-rules.mjs`：每条 `paths:` 必须匹配到文件，rules 与本文件里反引号写的仓库路径必须存在。

| 文件 | 触发路径 | 内容 |
|---|---|---|
| `eval.md` | `eval/**` | 判据不得带架构假设、sample 是视图、金标四件套与 `targetOf`/`labelBalance`、判官对齐、holdout 卫生 |
| `workers.md` | `apps/backend/**`、`services/meridian-ai-worker/**` | 本地验证（dev 直连生产 R2）、workflow step 规矩、观测、LLM 调用的坑、typecheck 的两个坑 |
| `prototypes.md` | `apps/*/prototypes/**`、`services/*/prototypes/**` | 三个子目录、`.gitignore` 模板、import 生产代码的风险、毕业约定 |

## 禁区（未明确要求不要碰）
- `packages/database/migrations/` — 历史 migration 不可变
- `services/meridian-ml-service/model-cache/` — 470MB 模型，gitignored
