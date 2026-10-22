# Lights-off：无人值守地跑出一个 PR

> 从 `CLAUDE.md` 按需指过来。**怎么做**在用户级 skill `lights-off`（`/lights-off`，文件在 `~/.claude/skills/lights-off/`，各项目通用）；
> 本仓的禁止清单、全量检查与次数上限在 `.claude/lights-off.json`。这份只讲为什么这样设计、用户定过什么、本仓特有的部分。

## 是什么

用户睡前交代一个需求，第二天读到实现它的 PR。**跑的时候没人盯；跑完人要读，PR 不直接合并。**
做完了就读完合并；没做完，提交历史加 PR 里写明的「撞到了什么、哪些路走不通」就是第二天开发的依据（用户 2026-10-21 定：不另设探路模式）。

「lights-off」借自制造业的熄灯工厂，经 Dan Shapiro 用到 AI 写代码上，原意是「代码没人写也没人审、直接进生产」，
HumanLayer《Why Software Factories Fail》的结论是这条路走不通。本仓只借前一半。

## 两个前提：目标对齐，结果有 back-pressure

用户 2026-10-07 定：自动化能不能成取决于两头，中间交给 agent。

1. **目标意图对齐**：开跑前人和 agent 对「要什么」理解一致。时间从别处省，这一步不省。
2. **back-pressure**：每一步都有一个不靠 agent 自己判断的信号告诉它对不对。没有它，agent 会在错的改动上越盖越高，早上拿到的只是「它自己说做完了」。

机器判不了的仍然归人：LLM 成稿的质量、代码设计的好坏。所以 PR 不直接合并。

## 机制（2026-10-23 做成 skill 时定的）

- **一个会话两段**：白天问清、写 spec；用户 `/clear` 后切到 bypass、再敲 `/lights-off` 开跑。夜里的会话只看 spec，不被白天的讨论带偏（Anthropic 的 Claude Code best practices 也这样建议）。
- **bypass + 禁止清单**：用户选 bypass（「出了问题后续再改 harness」）。实测 bypass 下 `permissions.deny` 与 PreToolUse hook 仍生效，所以防线是 `.claude/lights-off.json` 的 deny 与 limits，由用户级 hook `gate.mjs` 执行。它按命令写法匹配，换写法能绕过：挡的是顺手犯的错，漏的在审计与复盘里补。
- **收工由机器判**：主 agent 声明做完（`gate.mjs done`）后收工时，hook 跑全量检查，没过就拦回去；过了再拦一次，要它把审计（新增的 `eslint-disable`、跳过或删掉的测试、被拦的命令）贴进 PR。
  出处：Ralph 那次 6 小时的运行是 agent 自称做完才停的，产出很糟；HumanLayer、Mistele、StrongDM 都见过 agent 关 lint、改测试来过检查。
- **监工不许被关**（职责分离）：在跑时 hook 拦下 agent 清状态、改状态文件、项目配置、Claude 设置与 skill 本身，规则写死在 `gate.mjs` 里。夜里没收尾时只有用户能清（输入框里 `!` 开头的命令不经过 hook）。按写法匹配，故意绕路的由早上复盘读夜里的会话记录兜。
- **子 agent 没提交就收工会被拦**：提交时 pre-commit 会跑，相当于每个子 agent 都过了快检查。
- **被拦后要重交完整汇报**：实测被 hook 拦过一次的 agent，最后一条消息会被「我修好了」顶掉，收件人只看得到那一条。
- **状态放在 `.git/lights-off.json`**：每个仓库都有、不会被提交、worktree 里的 agent 也读得到；不在跑时 hook 约 70ms 放行。

## 本仓特有

- 最终裁判通常是 Staging 运行（`node scripts/staging-run.mjs`，红了非零退出）；一晚最多 5 次（约 $0.4 一次），由 limits 计数。
- 全量检查就是 pre-push（对主干的 merge-base 算碰到的包）。backend 测试要本机测试库。
- 夜里禁止：部署生产、写生产 bucket、改 secret、推 `main` 或强推（带租约的强推可以）、合并 PR、对生产库跑脚本、Neon MCP。

## 第二天合并叠起来的 PR（用户 2026-10-08 定）

从底往上逐个来：本地 `git merge --no-ff` 最底下那个分支进 `meridian-dev` → push → 把上一层 PR 的基底改指 `meridian-dev`（`gh pr edit <号> --base meridian-dev`）→ 再合上一层。
用 merge commit，不 squash。别先在本地一次全合完再改基底：上面几个 PR 的 diff 会变成累加的（#8–#12 就是这样，#12 显示成 148 个文件）。

## 出处

- HumanLayer：《Why Software Factories Fail》（`wsff.md`）、《A Brief History of Ralph》；`humanlayer/humanlayer` 的 `ralph_impl` 命令（没计划就不开跑、只接小票）。
- Kyle Mistele《Loop Engineering from First Principles》（确定性检查是传感器；小步增量，每个循环最多开一个 PR）。
- AI That Works #44《Agentic Backpressure Deep Dive》（learning test：先用代码证实前提，再写 spec）。
- Anthropic《Effective harnesses for long-running agents》与 Claude Code best practices（Stop hook 是让无人值守的运行正确收尾的手段；审查员只报正确性与没满足的要求）。
- 视频只读了文字材料（仓库里的 EPISODE.md、自动字幕、会议转写），网页多经摘要工具读取，引文没有逐字核对原页。
