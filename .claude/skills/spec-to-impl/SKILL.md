---
name: spec-to-impl
description: spec 定稿后把它拆票、派 subagent 并行实现、合并验收。触发时机由上下文判断：`/to-spec` 写出的 spec（`.scratch/<功能名>/spec.md`）用户已审过、没有待改的地方时，先向用户提议「spec 定了，要开始拆票、派 subagent 实现吗？」，用户同意后再按本 skill 执行。不要在 spec 还在改、或用户没同意时自己开跑。
---

# spec → 拆票 → 并行实现

matt 的 `to-tickets`、`implement` 只能由用户手动触发，这里按指针读它们的原文照做；matt 原文没管的编排规则写在本文件里。

## 0. 前置检查

- spec 在 `.scratch/<功能名>/spec.md`（位置约定见 `docs/agents/issue-tracker.md`），用户已审过并同意开跑。
- 下面两份原文要存在。任何一份读不到就停下告诉用户（matt 可能改了目录结构），不要凭记忆执行：
  - `~/.claude/plugins/marketplaces/mattpocock/skills/engineering/to-tickets/SKILL.md`
  - `~/.claude/plugins/marketplaces/mattpocock/skills/engineering/implement/SKILL.md`

## 1. 拆票：读 to-tickets 原文照做

`.scratch/<功能名>/issues/` 里已经有票（用户手动跑过 `/to-tickets`）时跳过本步，直接用那些票进第 2 步。

与原文不同的只有两处：
- **跳过「Quiz the user」那一步**：用户的介入点是审 spec，拆票粒度由 agent 定。
- 票写到 `.scratch/<功能名>/issues/<NN>-<slug>.md`（原文的本地 tracker 格式）。

拆票时额外对照 spec 做两件事：
- 每张票的验收条件只放确定性部分（接口、守卫、重试、出处可解析）；LLM 输出质量不进验收条件，测试接缝优先用 replay（录下来的 LLM 回复）。
- spec 若写了「替换什么、删什么」，删旧链路单独成一张票，被新链路的票阻塞。它是本地收缩的一步，旧代码没删干净时 pre-push 的路由对账和 knip `--production` 会拦。

## 2. 派 subagent：每张票一个

- 能并行的前提（全局 CLAUDE.md 三条）：块之间不共享状态、每块有自己的可执行判据、接口约定已在 spec 里写死。不满足就按依赖顺序串行派。
- 派之前先 commit：worktree 从本地 HEAD 建，未提交的改动带不过去。
- Agent 调用参数：`isolation: "worktree"`；显式传 `model`——改动点清楚、有测试兜底的用 `"sonnet"`，跨模块、有歧义、涉及并发或状态的用 `"opus"`。
- 给 subagent 的 prompt 写清：
  - 票文件的路径，以及 spec 路径（只读）
  - 读 `implement` 原文（上面的路径）照做：按 `tdd` skill 在票里定好的接缝上红绿循环，定期跑 typecheck 与单个测试文件，完成后跑 `code-review`，commit 到自己的 worktree 分支
  - 不许再派 subagent；不许改接口约定，发现约定走不通就停下报告
  - 回报：改了哪些文件、测试命令与退出码、commit hash

## 3. 合并与验收（主会话做）

- subagent 自报完成不算数：合并前自己看 diff、重跑它报的测试命令。
- 按依赖顺序合回当前分支；冲突用 `resolving-merge-conflicts` skill。
- 合并后跑全量判据，这是唯一验收：`pnpm typecheck`、`pnpm exec knip`、`pnpm exec knip --production`、`node scripts/check-routes.mjs`、`pnpm lint`，以及碰到的包的测试（命令见 `CLAUDE.md`「工作规则」）。
- 每张票在票文件里记 `Status: resolved`，并附 commit hash。

## 4. 交回用户

- 汇报：完成了哪些票、全量判据结果，以及没验证的部分（尤其 LLM 输出质量要上线后读真实输出）。
- 部署与 push 由用户决定。
