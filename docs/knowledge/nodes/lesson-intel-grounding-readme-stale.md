---
{
  "id": "lesson-intel-grounding-readme-stale",
  "type": "lesson",
  "title": "算出来的验收结果不会自动同步进 README 状态行——intel-grounding 的「judge 未验证」在有 κ 数字之后仍挂了两个多月",
  "date": "2026-09-22",
  "status": "recorded",
  "tasks": ["设计验收门"],
  "scope": "本仓 scripts/eval/ 下所有依赖 README 顶部「状态行」传达验收进度的 harness；不特指某一次代码缺陷",
  "source": "scripts/eval/intel-grounding/README.md:12（截至 2026-09-22 仍写「本线状态：harness ready，judge 未验证...不得把本线的任何读数当可信」）对照 commit 36e186a（2026-07-10）message 里已经给出的 κ 数字；README.md:68-77「还差什么才算 eval 真正完成」节列出的三步（建真人金标/填充合成批/跑 κ 验收闸）在 commit 时间线上其实已经做完前两步、第三步也已经跑出过结果",
  "conditions": [
    "README 的「未验证」警告写于更早的 commit（本节点未逐一定位哪一条 commit 首次写下这句话，只确认它在 36e186a 之后的 HEAD 仍然存在，未被更新）",
    "36e186a 之后该目录还有 e31fbf9（补 skipCache）、61a3bcc（判官客户端收敛）等 6 次后续 commit，没有一次修改 README 的状态行",
    "对照组：coverage-judge 的 README 在验完 κ 后确实把「结果」小节写回了 README（见 scripts/eval/coverage-judge/README.md「结果（2026-07-03 首验）」节），状态描述与实际验收结果保持同步——同一个仓库里两种做法并存，intel-grounding 是反例，coverage-judge 是正例"
  ],
  "evidence_origin": "local_record",
  "relations": [],
  "kind": "observation",
  "invalidates_when": "本仓引入了「验收结果自动回写 README/状态文件」的机制（例如 stop-hook 类似的校验），使得代码里的验收状态与文档描述不可能出现这种漂移"
}
---

**观察**：intel-grounding 的 README 顶部写着一条醒目警告——「harness ready，judge 未验证，
在用户完成金标+κ验收前，不得把本线任何读数当可信」。但对照 commit 历史，36e186a
（2026-07-10）这次提交已经完成了 README「还差什么」节列出的前两步（真人金标 100+24 条、
合成扰动批 26 条），并且跑出了具体的 κ 数字（qwen 0.407 FAIL，Claude 0.779 通过但离线未复验，
deepseek 更差）。换句话说，**README 描述的「差什么」在事实上已经部分做完，但 README 本身
从未更新**，截至本次蒸馏（2026-09-22）它依然原样挂着「未验证」的警告。

**根因不是代码 bug，是习惯性遗漏**：这类 harness 的验收状态默认写在 README 的自然语言里，
没有任何机制强制「κ 算出来之后必须回写 README」。对照同一批 eval 里的 coverage-judge——
它在验完之后专门在 README 加了一节「结果（2026-07-03 首验）」，把 κ/precision/recall
写回文档——说明这不是不能做，只是这次没做。

**为什么值得记**：下次任何人（人或 agent）读到一个 harness 的 README 说"未验证/占位/待办"，
不能直接采信为当前状态，要去比对该目录的 commit 历史和 gitignored 的 `out/` 产物——
文档状态行可能已经过期。这个仓库两周前（2026-09-20）刚定下 eval 四层契约
（见 [[decision-eval-module-contracts]]），但契约管的是 dataset/solver/scorer/judge
的职责边界，不管"验收结果要不要回写文档"这件事——**这次教训指向的是文档维护习惯，
不是架构缺陷**，机制化的解法（比如让 knowledge 校验脚本顺带检查 README 状态行与最近
commit 的时间差）目前还不存在。
