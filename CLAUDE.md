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

## 已知坑
- **CF Workflow 单 step 输出 ~1MB 上限**——曾因情报 step 内联返回全部 story 报告而触发 `WorkflowInternalError`（当时靠 `maxStoriesToGenerate=3` 规避）。**已解决（2026-06）**：情报报告卸载 R2、step 只回传 keys（`auto-brief-generation.ts`），现 `maxStoriesToGenerate=15` 安全。新增 step 若要传大对象，沿用"卸 R2 + 传 key"模式
- `services/meridian-ml-service/model-cache/` gitignored，新机器需先 `bash download.sh` 拉模型（470MB）
- `*.workers.dev` 在国内会被 RST，需走代理节点
- 调试三件套：`wrangler tail` / `wrangler workflows instances describe` / R2 `observability/*.json`
- **更多 LLM pipeline 踩坑** → 读 `docs/engineering-notes/llm-pipeline-pitfalls.md`（仅本地）

## 何时读哪份 docs
- 改工作流编排 → `docs/meridian-workflow-architecture.md`
- 跨 service 调用 → `apps/backend/src/lib/services/ai-services.ts`（客户端方法即契约，比文档准）
- 部署前 → `docs/DEPLOYMENT_GUIDE.md`
- 观测/排错 → `docs/OBSERVABILITY_GUIDE.md`
- 改算法（聚类/切分/简报合成）→ `docs/adr/0003-cluster-as-brief-block.md`（现行链路与已证伪清单）
- 改写作层（报告 → 正文）/ 治事实关系写错 → `docs/adr/0004-brief-writer-v3.md`（现行流程、证伪清单、检测上限）
- 找调研依据 → `docs/engineering-notes/README.md`（按问题索引）
- 做 eval / 定判据 / 派判官 → `docs/adr/0006-eval-bootstrap-and-ruler-recalibration.md`（硬规矩在 `.claude/rules/eval.md`，改 eval 代码时自动载入；字段与签名的参考在 `scripts/eval/cluster-to-brief/CONTRACTS.md`）
- 架构决策记录 → `docs/adr/`

## 知识蒸馏（每个 spike / goal 结束时做）

> **开工前先查 `docs/knowledge/INDEX.md`**：按任务找到旧尝试、实验、经验与可复用机制，说清
> 本轮相对旧尝试的变化、为什么可能绕过失败、希望获得的唯一新信息。不要把相同机制换措辞当新架构。
>
> **GOAL 节点只在我主动提起时才写。** 不要提议"要不要起个 GOAL"——它不产生任何新信息，
> 拿它当下一步动作只是用仪式占掉真正该做的事。上面那三个问题照答，但答在对话里，不是先立节点。
>
> spike 结束记录 **experiment + lesson**，链接对应 attempt；缺失运行条件标未知，小样本通过与扩展失败分别保留。
> 提炼可复用功能时写 mechanism 的输入、输出与限制；组合 attempt 用 `incorporates` 明确调整，组合效果另验。
> 证据、正常对照、成本、适用前提与失效条件必须保存；LLM 自报状态和机械通过不是独立语义验收。
> 决定记录依据，旧决定取代不删除。格式见 `docs/knowledge/README.md`；跑 `pnpm -s knowledge` 校验并重建索引、反向链接与 graph.json。

调研笔记和原型只留本地、不入 git（2026-09-12 定），所以**结论必须蒸馏进入库的文档**，否则等于没有：
- 探索历史实体（goal / attempt / experiment / lesson / mechanism / decision，JSON frontmatter + 正文）→ `docs/knowledge/nodes/`，详细产物仍留本地，用 `source` 指过去
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
| eval harness / 金标 / rubric | `scripts/eval/<domain>/`（`.ts` + `gold/*.jsonl` + `*.md`） | ✅ |
| eval 中间产物（worklist / packet / dump） | 留 `scripts/eval/<domain>/`，由该目录 `.gitignore` 挡 | ❌ |
| eval 运行报告 | 该 harness 目录下的 `out/`（`.gitignore` 已挡） | ❌ |
| 原型 / 探索实验（含 fixtures 与产物） | `<package>/prototypes/<name>/`，**必带 `.gitignore`** | ❌ 只留本地（根 `.gitignore` 整目录挡） |
| 一次性探测脚本 / 临时输出 | scratchpad，不进 repo | ❌ |
| 调研笔记（业界/学界调研、原始实测记录） | `docs/engineering-notes/`，按问题索引在其 `README.md` | ❌ 只留本地（根 `.gitignore` 挡） |
| 决定与证伪清单 | `docs/adr/` | ✅ |
| 术语表 | `CONTEXT.md` | ✅ |
| 工程/架构/运维文档、路线图 | `docs/`（架构、部署、观测、ROADMAP） | ✅ |
| 设计交付稿（design handoff） | `docs/design/<name>/` | ✅ |
| session 交接记录（`*-handoff.md`） | 工作流水账，不入库（`.gitignore` 挡 `docs/*-handoff.md`） | ❌ |
| 密钥 | `.dev.vars`（gitignore），只提交 `.dev.vars.example` | 仅模板✅ |

**判据一句话**：能让别人**复现或验证**的（代码/测试/金标/说明书/输入 fixtures）→ 入 git；
某次运行的**产物**或某次交接的**流水账**（dump/report/handoff/临时脚本）→ 不入。

原型与 eval harness 都是 pnpm workspace 成员，各目录只留 `package.json`，
根目录 `pnpm install` 一次装完。原型的目录结构、`.gitignore` 模板与「毕业」约定见
`.claude/rules/prototypes.md`（改原型时自动载入）。

## 路径触发的规则（`.claude/rules/`）

按路径自动载入，不占常驻上下文。改到对应目录时才进来：

| 文件 | 触发路径 | 内容 |
|---|---|---|
| `eval.md` | `eval/**`、`scripts/eval/**` | 判据不得带架构假设、sample 是视图、金标四件套与 `targetOf`/`labelBalance`、判官对齐、holdout 卫生 |
| `local-verification.md` | `apps/backend/**`、`services/meridian-ai-worker/**` | wrangler dev 单端点与联调、R2 注意事项、typecheck 的两个坑 |
| `prototypes.md` | `*/prototypes/**` | 三个子目录、`.gitignore` 模板、import 生产代码的风险、毕业约定 |

## 禁区（未明确要求不要碰）
- `packages/database/drizzle/` — 历史 migration 不可变
- `services/meridian-ml-service/model-cache/` — 470MB 模型，gitignored
- `apps/backend/src/tests/` — gitignored
