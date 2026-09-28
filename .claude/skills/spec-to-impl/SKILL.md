---
name: spec-to-impl
description: spec 定稿后把它拆票、派 subagent 并行实现、合并验收。触发时机由上下文判断：spec（`/to-spec` 写的或用户手写的，通常在 `.scratch/<功能名>/spec.md`）用户已明确认可、没有待改的地方时，先向用户提议「spec 定了，要开始拆票、派 subagent 实现吗？」，同意后再执行；用户认可 spec 的同一句话里已经说了开始（如「可以，开始吧」）就直接执行。spec 还在改、用户只是读完没表态、或没同意时不要开跑；提议后用户没回应就不再重复提。
---

# spec → 拆票 → 并行实现

matt 的 `to-tickets`、`implement` 只能由用户手动触发，这里按指针读它们的原文照做；matt 原文没管的编排规则写在本文件里。

## 0. 前置检查

- spec 位置按 `docs/agents/issue-tracker.md`，用户已认可并同意开跑。
- 下面两份原文要存在。任何一份读不到就停下告诉用户（matt 可能改了目录结构），不要凭记忆执行：
  - `~/.claude/plugins/marketplaces/mattpocock/skills/engineering/to-tickets/SKILL.md`
  - `~/.claude/plugins/marketplaces/mattpocock/skills/engineering/implement/SKILL.md`

## 1. 拆票：读 to-tickets 原文照做

`.scratch/<功能名>/issues/` 里已经有票（用户手动跑过 `/to-tickets`）时跳过本步，直接用那些票进第 2 步。

与原文不同的地方：
- **跳过「Quiz the user」那一步**：用户的介入点是审 spec，拆票粒度由 agent 定。
- 票写到 `.scratch/<功能名>/issues/<NN>-<slug>.md`（原文的本地 tracker 格式）。
- **接口约定单独成第一张票，由主会话自己做完并 commit**，之后的票才能并行。约定写死后，允许按服务横切（如 ai-worker 一张、backend 一张）换并行，不必强求原文的端到端纵切。

拆票时额外对照 spec：
- 每张票的验收条件只放确定性部分（接口、守卫、重试、出处可解析）；LLM 输出质量不进验收条件。
- 测试接缝：改动不碰 prompt 时优先用 replay（录下来的 LLM 回复）；改了 prompt 时 replay 按 prompt 哈希查不到录像，改用 ai-worker 服务层替换 `env.AI` 的测试与 backend 纯函数的 golden 快照。
- spec 若写了「替换什么、删什么」，删旧链路单独成一张票，被新链路的票阻塞；若要等用户读完上线后的真实输出再删，把这道人工门写进 Blocked by，本轮不派。

## 2. 派 subagent：每张票一个

- 能并行的前提（全局 CLAUDE.md 三条）：块之间不共享状态、每块有自己的可执行判据、接口约定已写死并 commit。不满足就按依赖顺序串行派。
- 派之前先 commit：worktree 从本地 HEAD 建，未提交的改动带不过去。
- `.scratch/` 被 gitignore，worktree 里没有：prompt 里的票和 spec 一律写**主仓库的绝对路径**，注明只读。
- worktree 里没有 `node_modules`：prompt 里让 subagent 开工先跑 `pnpm install --frozen-lockfile --prefer-offline`，否则 typecheck 和 pre-commit 都跑不起来。
- Agent 调用参数：`isolation: "worktree"`；显式传 `model`——改动点清楚、有测试兜底的用 `"sonnet"`，跨模块、有歧义、涉及并发或状态的用 `"opus"`。
- 给 subagent 的 prompt 写清：
  - 票与 spec 的绝对路径（只读）
  - 读 `implement` 原文（上面的路径）照做，但 **`code-review` 那步不做**（它会再派 subagent，由主会话在合并前做），**全量测试也不跑**（主会话合并后统一跑），只跑自己包的测试：按 `tdd` skill 在票里定好的接缝上红绿循环，定期跑 typecheck 与单个测试文件，commit 到自己的 worktree 分支。backend 测试要本机测试库：手动跑前先 `. .githooks/lib.sh`（它给 `BACKEND_TEST_DATABASE_URL` 设了默认值，只有 hook 自动带），库的准备见 `apps/backend/test/README.md`「数据库」
  - 不许再派 subagent；不许改接口约定，发现约定走不通就停下报告
  - 回报：改了哪些文件、测试命令与退出码、commit hash、分支名

## 3. 审查、合并与验收（主会话做）

- subagent 自报完成不算数：看 diff、重跑它报的测试命令。
- 合并前对每张票的分支跑 `mattpocock-skills:code-review`（以票与 spec 为依据）。它默认拿 HEAD 比基准点，审别的分支时把 diff 命令换成 `git diff <契约 commit>...<票分支>`。
- 审出的问题分两类处理：
  - **代码偏离了 spec**：修（交回该 subagent 或主会话自己改），修完再合。
  - **spec 本身错了**（如误伤了 spec 没考虑到的现有链路）：**停下，不合并**，把问题和可选改法交给用户——spec 是用户拍板的，agent 不自己改。
- 按依赖顺序合回当前分支；冲突用 `resolving-merge-conflicts` skill。
- 合并后跑全量判据，这是唯一验收：`pnpm typecheck`、`pnpm exec knip`、`pnpm exec knip --production`、`node scripts/check-routes.mjs`、`pnpm lint`，以及碰到的包的测试（命令见 `CLAUDE.md`「工作规则」）。
- **新旧链路并存期**（删旧票还没做）：路由对账、knip `--production` 只因旧链路没人调而报的项是预期内的，逐条列给用户，**不加白名单或 `@internal` 豁免**；其余报错照常必须修。删旧票做完、判据全绿之前不 push（expand–contract 在本地完成）；用户要在这期间 push 别的东西时，提醒用户会被拦，由用户决定。
- 每张票在票文件里记 `Status: resolved`，并附 commit hash。

## 4. 交回用户

- 汇报：完成了哪些票、全量判据结果、并存期的预期报错清单、没验证的部分（尤其 LLM 输出质量要上线后读真实输出）。
- 部署与 push 由用户决定。
