---
{
  "id": "experiment-story-validation-verify-stage-tradeoff",
  "type": "experiment",
  "title": "复核（二审）步骤拿召回换精度：103 个故事削到 74 个，事件召回 98%→76%，严精度 75.7%→89.2%，前 15 条精度 53.3%→93.3%",
  "date": "2026-08-20",
  "status": "recorded",
  "tasks": ["治故事过拆", "设计验收门"],
  "scope": "story-validation 两段式架构（判官 getStoryJudgePrompt + 复核 getStoryVerifyPrompt）里，加入复核步骤前后的对照；人工严口径标注（scripts/eval/story-validation/rubric.md 定义的 correct/umbrella/wrongPair/borderline 四分类）",
  "source": "services/meridian-ai-worker/src/prompts/storyValidation.ts:182-188；services/meridian-ai-worker/src/services/story-validation.ts:65-73",
  "conditions": [
    "『严精度』指 rubric.md 的人工严口径（故事内不能混入别的发生才算 correct），区别于机械尺 event_recall2.mjs 的宽口径（故事内有真核即算对，2026-08-20 实测宽口径 75% vs 严口径仅 41.7%，差距全在伞状）",
    "下游 maxStoriesToGenerate 只放 15 条进情报分析，所以『进简报的真故事条数』这个口径（8 条→14 条）比『总故事数量』（103→74）更贴近实际收益",
    "两天独立复验（08-18 与 08-20）里，『进简报的前 15 条精度 93.3%』的结论保持一致（storyValidation.ts:19 与 story-validation.ts:73 均写『两天相同』）"
  ],
  "evidence_origin": "local_record",
  "relations": [
    { "type": "yields", "to": "lesson-story-validation-verify-precision-recall-tradeoff" }
  ],
  "kind": "probe",
  "outcome": "passed",
  "inputs": "同一批候选组产出的判官结果（103 个故事）vs 判官+复核两步结果（74 个故事）",
  "evaluation": "人工严口径四分类标注，分别统计『事件召回』『严精度（全部故事）』『前 15 条精度（按 blockImportance/CoT rubric 排序后取前 15）』三个指标",
  "result": "复核步骤把 103 个故事削到 74 个：事件召回从 98% 降到 76%（漏掉了约 24% 原本判官找出的真实事件），但严精度从 75.7% 升到 89.2%，前 15 条精度从 53.3% 大幅升到 93.3%。按『实际进简报的真故事条数』折算是 8 条升到 14 条——复核这一步净赚，因为下游只消费前 15 条，牺牲的召回主要发生在本就进不了前 15 的低分故事上。",
  "cost": "未知（复核步骤本身的调用量见 story-validation.ts:22-23：全量 57 簇 1254 篇场景下约 195 次复核调用，单次复核中位耗时 2.3s，但该成本数字来自另一次全量运行，非本实验的直接成本记录）",
  "record_completeness": "summary_only"
}
---

## 读数原文

`storyValidation.ts:182-188`：

> 这一步是拿召回换精度：08-20 实测它把 103 个故事削到 74 个，事件召回 98%→76%，
> 但严精度 75.7%→89.2%、**前 15 条精度 53.3%→93.3%**。
> 下游 maxStoriesToGenerate 只放 15 条进情报分析，所以按「实际进简报的真故事条数」算
> 是 8 条 → 14 条，复核这一步是净赚的。

`story-validation.ts:65-73`（架构总述，两天复验一致的总体精度）：

> 人工严口径（scripts/eval/story-validation/rubric.md，08-18 与 08-20 两天独立复验）：
> 生产原形态 41.7% → 本形态 89-92%；进简报的前 15 条精度 93.3%（两天相同）。

## 为什么净赚判断依赖『下游只取前 15』这个前提

这条『净赚』结论不是无条件成立的——它成立是因为下游 `maxStoriesToGenerate` 只消费
排序后的前 15 条。若下游改成消费全部验证通过的故事（例如某天新闻量小、故事数不足 15），
复核步骤丢掉的 22 个百分点召回（98%→76%）会直接转化成漏报的真实事件，『净赚』的前提
就不再成立。这是这条读数的一个隐含适用边界，源文件本身没有单独提示。

## 关联

产生 [[lesson-story-validation-verify-precision-recall-tradeoff]]。与
[[experiment-story-validation-architecture-error-taxonomy]] 是同一次架构替换的两个侧面：
后者讲『判官单独一段』相对『整簇自由划』的错误类型转变（umbrella→wrongPair），
本节点讲『判官+复核两段式』相对『判官单独一段』在同一批 wrongPair/umbrella 候选里
进一步做的精度/召回取舍。
