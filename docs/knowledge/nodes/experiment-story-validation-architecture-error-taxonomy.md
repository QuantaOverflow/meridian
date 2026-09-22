---
{
  "id": "experiment-story-validation-architecture-error-taxonomy",
  "type": "experiment",
  "title": "故事切分错误类型随分解策略完全反转：整簇自由划错误 86% 是 umbrella，几何预分组后错误 80–100% 是 wrongPair",
  "date": "2026-08-20",
  "status": "recorded",
  "tasks": ["治故事过拆", "设计验收门"],
  "scope": "story-validation 环节的 7 个架构臂对照，244 条产出标注，按成员集去重后 113 个唯一成员集人工严口径标注（correct/umbrella/wrongPair/borderline 四分类）",
  "source": "eval/story-validation/rubric.md（HEAD 版本，随本轮清理被删除，可用 `git show HEAD:eval/story-validation/rubric.md` 或 commit b7ab0ea 恢复查看）第 1 节与第 6 节；commit b7ab0ea 提交信息本身",
  "conditions": [
    "7 个架构臂具体是哪些未在 rubric.md 中逐一列出，只区分『整簇自由划』与『几何预分组』两大类",
    "umbrella 定义：故事内有真核（≥2 篇确实同一发生）但混入了别的发生；wrongPair 定义：压根没有真核，成员是题材/地域/人物相似的不同发生被硬凑",
    "commit b7ab0ea 的提交说明文字写的是『几何预分组错误 76-82% 是 wrongPair』，与 rubric.md 文件正文『80–100%』不一致——本节点采用文件正文（读原文优先于转述）",
    "113 个唯一成员集的总体分布：correct 51 / wrongPair 37 / umbrella 25（合计 113，未按架构臂拆分，是全部去重后的汇总分布）"
  ],
  "evidence_origin": "local_record",
  "relations": [
    { "type": "yields", "to": "lesson-legal-exclusion-path-prevents-forced-fit" }
  ],
  "kind": "probe",
  "outcome": "observed",
  "inputs": "7 个 story-validation 架构臂在同一批文章数据上的产出，244 条候选故事，人工按 rubric 去重后标注 113 个唯一成员集",
  "evaluation": "人工严口径四分类标注（correct/umbrella/wrongPair/borderline），umbrella 与 wrongPair 分开统计（rubric.md 明确要求：『两者的修法完全不同』）",
  "result": "整簇自由划的架构臂，错误里 86% 是 umbrella（有真核但混入别的发生）。先做几何预分组的架构臂，umbrella 基本消灭，错误里 80–100% 是 wrongPair（压根没有真核，题材/地域/人物相似的不同发生被硬凑）。即：几何预分组解决了『混进别的发生』，代价是把语义相近但非同一发生的两篇文章送到了判官面前，判官若不能拒绝就会被迫强配。",
  "cost": "未知（未记录标注工时或 LLM 调用成本）",
  "record_completeness": "summary_only"
}
---

## 读数原文

`rubric.md`（HEAD 版本）第 1 节：

> `umbrella` 与 `wrongPair` 必须分开统计：两者的修法完全不同。实测（2026-08-20，7 个架构臂 244 条）：
> - **让 LLM 在整簇里自由划**的臂，错误 86% 是 `umbrella`
> - **先做几何预分组**的臂，`umbrella` 基本消灭，错误 80–100% 是 `wrongPair`
>
> 即几何预分组解决「混进别的发生」，代价是把语义近但非同一发生的两篇送到判官面前。

## 为什么这条读数值得单独立一条实验节点

它是 [[lesson-llm-oversplits-single-large-event]] 之外、同一批标注体系下的另一条独立发现，
此前未被蒸馏：故事切分的『错误率』这个单一数字会掩盖『错误的性质』——同样是失败，
一种失败（umbrella，漏掉了本该拆开的事）和另一种失败（wrongPair，硬凑了本不该在一起的事）
需要完全不同的修法。不分开统计，看到『精度提升』时无法判断到底是把哪种错误治好了。

## 关联

产生 [[lesson-legal-exclusion-path-prevents-forced-fit]]。与
[[experiment-story-validation-verify-stage-tradeoff]] 是同一次架构替换
（2026-08-21，见 services/meridian-ai-worker/src/prompts/storyValidation.ts:1-19）
里的两个不同侧面：本节点讲『判官单独一段』相对『整簇自由划』的错误类型转变，
另一节点讲『判官+复核两段式』相对『判官单独一段』的召回/精度取舍。
