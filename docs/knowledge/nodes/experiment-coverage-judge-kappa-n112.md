---
{
  "id": "experiment-coverage-judge-kappa-n112",
  "type": "experiment",
  "title": "覆盖对账判官（reconcileCoverage）在 112 条三角测量金标上 κ=0.965 通过，dropped precision=1.000；随后用它验证两遍法把合成漏报从 13.4% 压到 0%",
  "date": "2026-07-08",
  "status": "recorded",
  "tasks": ["设计验收门", "改报告层结构"],
  "scope": "scripts/eval/coverage-judge/ 验的是 reconcileCoverage 这一个判官（判候选 story 在成品简报里的去向 headline/noteworthy/dropped），gold 取自 8 期真实 admin-brief workflow；不代表其他判官或其他简报生成路径",
  "source": "commit d2b6f09（2026-07-07，feat(eval): 覆盖对账判官 κ 验证 harness）；commit 52acb84（2026-07-07，feat(brief-gen): 合成漏报修复(覆盖契约)+A/B双尺复测 dropped 13.4%→6.2%）；commit 232b15e（2026-07-08，feat(brief-gen): 两遍法覆盖补录(coverage repair)——合成漏报 0/112 硬保证）；scripts/eval/coverage-judge/disagreements.md（35 条分歧样本明细）；scripts/eval/coverage-judge/README.md「结果（2026-07-03 首验）」节",
  "conditions": [
    "母集团：到达合成层的 story（brief_stories.selected_for_intel=true 且 intel_report_r2_key 非空），取自 error-analysis 路2 用过的 8 条真实 brief（admin-brief-*），共 112 story-disposition 组",
    "gold 构成：77 三尺一致 + 16 grounded（简报正文实体检索坐实）+ 2 人裁 + 17 headline↔noteworthy 多数决",
    "三尺方法论见 [[mechanism-coverage-judge-triangulation]]：judge=qwen-long（三分类）/ codex=GPT（异家族第二标注）/ det=无 LLM 专有名词加权词汇重叠对齐器（dropped/covered 强、headline/noteworthy 弱）",
    "忠实点：顺序对齐生产（R2 key idx 昇序=intel step 顺=生产 reports[] 顺）、label 用 executiveSummary.replace(/\\s+/g,' ').trim().slice(0,160)（与 runtime reconcileCoverage 完全一致）、判定兜底（漏判/非法 disposition→dropped）与生产一致",
    "A/B 复测前置条件：8 期生产简报的原始生成时间早于 bc3f8a9（RARR+输入修复），不能直接当对照，因此两臂（baseline/treatment）都在同一份代码 HEAD 上重放生成，唯一变量是 prompt",
    "两遍法（232b15e）的 repairCoverage 不经 LLM：程序化从 dropped story 的 executiveSummary 逐字取首句补插 noteworthy，by-construction 不引入新编造；对账失败则跳过（best-effort，不拖垮主流程）"
  ],
  "evidence_origin": "local_record",
  "relations": [],
  "kind": "probe",
  "outcome": "passed",
  "inputs": "112 条 story-disposition 三角测量金标（详见 conditions）",
  "evaluation": "Cohen's κ（三分类 headline/noteworthy/dropped，以及决策级二分类 covered/dropped）+ dropped 类 precision/recall；gate：κ≥0.6 且 dropped precision≥0.8",
  "result": "PASS。三分类 κ=0.965，决策级(covered/dropped) κ=0.968，dropped precision=1.000（判官喊的 18 条 dropped 全部真实为 dropped，不会虚增「合成漏报」计数），dropped recall=0.947（19 条真实漏报中抓到 18，漏 1 条为边界例）。错配仅 2/112，方向均为判官偏松（over-covered），与 qwen 同家族 self-preference 的方向一致——说明用这把尺算出的漏报数是偏保守而非偏高估计。随后用这把已验证的判官做了一次真实生产修复的 A/B：13.4%(旧 prompt 基线) → 6.2%(仅改 prompt) → 0.0%(两遍法程序化补录, 19 条 gold 漏报全救回)。忠实度门同步复测：twopass 批 contradicted 与基线相当(7 vs 6)，unsupported 全场最低(1.1%)。",
  "cost": "未知——commit message 未记录 LLM 调用量与费用；112 条金标 × 三个标注源 + 35 条人裁 + 两轮 A/B（每轮 8 期简报重新生成）的总成本未留痕",
  "record_completeness": "summary_only"
}
---

## 与 error-analysis 「合成漏报占缺陷 68%」的关系（不重复记录）

d2b6f09 的 commit message 明确写道，这次 κ 验证「是 error-analysis 路2『合成漏报占缺陷 68%』
头号结论的依据」。这个 68% 数字本身**已经蒸馏进本仓的其他已入库文档**，不在本节点重复：
`docs/ROADMAP.md:151`、`docs/adr/0004-brief-writer-v3.md:53`、
`scripts/eval/error-analysis/README.md`「背景」节都记着这个数字，且 ROADMAP 明确写
"合成漏报已于 2026-07-08 收口（dropped 13.4% → 0.0%）"——与本节点的 A/B 结果一致。
用户的私人 memory 里也已经有 `error-analysis-path2-attribution` 这条节点记录了逐层归因
的聚合表，并诚实标注"逐条 open-code 明细已丢，只剩聚合百分比"。

本节点记录的是**验证 judge 本身可信度**这一步（κ=0.965），它是让"dropped=漏报"这个消费
口径立得住的前提，而不是重新推导 68% 这个数字——两者是因果链上相邻但独立的两件事：
先有本节点的 κ 验证，"dropped 计数可信"这个结论才立得住；68% 的归因数字则来自另一批
open-code 人工判读（error-analysis 路2），不是从这 112 条 gold 里算出来的。

## 三尺分歧率本身也是一个读数

112 条里 35 条（约 31%）三尺不一致、需要人裁，说明即便是"story 去向"这种看起来客观的
判断，三个独立信号源的自然分歧率也不低。这个比例可以作为以后设计类似三角测量时的参照——
如果新任务的分歧率远高于 31%，大概率意味着判定粒度本身需要重新设计，而不是简单加标注器
就能收敛（见 [[mechanism-coverage-judge-triangulation]] 的 invalidates_when）。
