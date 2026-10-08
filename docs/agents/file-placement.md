# 新文件放哪（落位规则）

> 从 `CLAUDE.md` 按需指过来：新增任何文件前读。

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
| 术语表 | `GLOSSARY.md` | ✅ |
| 链路总览、部署、观测排错（给人读） | `docs/how-it-works.md`、`docs/deployment.md`、`docs/monitoring.md`、`docs/development.md` | ✅ |
| 给外部读者的门面（是什么、截图、线上地址、出处） | 根 `README.md`，截图在 `docs/assets/` | ✅ |
| 写代码时的硬规矩（给 agent） | `.claude/rules/<topic>.md`，`paths:` 写到包一级 | ✅ |
| 给 agent 的流程说明（按需读，`CLAUDE.md` 留指针） | `docs/agents/<topic>.md` | ✅ |
| 路线图、技术债 | `docs/ROADMAP.md`、`docs/debt.md` | ✅ |
| 设计交付稿（design handoff） | `docs/design/<name>/`；前端实现后以代码为准 | ❌ 只留本地（根 `.gitignore` 挡） |
| matt skill 的 spec、票、wayfinder 地图 | `.scratch/<功能名>/`；结论蒸馏进 ADR | ❌（根 `.gitignore` 挡） |
| session 交接记录（`*-handoff.md`） | 工作流水账，不入库（`.gitignore` 挡 `docs/*-handoff.md`） | ❌ |
| 密钥 | `.dev.vars`（gitignore），只提交 `.dev.vars.example` | 仅模板✅ |

**判据一句话**：能让别人**复现或验证**的（代码/测试/金标/说明书/输入 fixtures）→ 入 git；
某次运行的**产物**或某次交接的**流水账**（dump/report/handoff/临时脚本）→ 不入。

原型与 eval harness 都是 pnpm workspace 成员，各目录只留 `package.json`，
根目录 `pnpm install` 一次装完。原型的目录结构、`.gitignore` 模板与「毕业」约定见
`.claude/rules/prototypes.md`（改原型时自动载入）。
