---
{
  "id": "lesson-story-validation-verify-precision-recall-tradeoff",
  "type": "lesson",
  "title": "故事验证的精度与召回是硬取舍：拆得越严去伪存真越准，漏掉的真实事件也越多，不存在两头都好的免费操作",
  "date": "2026-08-20",
  "status": "recorded",
  "tasks": ["治故事过拆", "设计验收门"],
  "scope": "任何『候选生成 → 二审收紧』两段式的验证/过滤管线，尤其是候选生成阶段本就允许过召回（宁可多召回，交给下一段收紧）",
  "source": "services/meridian-ai-worker/src/prompts/storyValidation.ts:182-188；services/meridian-ai-worker/src/services/story-validation.ts:65-73",
  "conditions": [
    "『净赚』的判断依赖下游只消费排序后的前 K 条这一前提，见 experiment-story-validation-verify-stage-tradeoff 的适用边界说明——下游若改为消费全部通过项，结论会反转",
    "本节点讨论的是 story-validation 自身『二审严格到什么程度』这一维度上的取舍，与聚类阶段该不该追求高召回是两个不同的环节职责（聚类阶段的职责边界见用户 memory clustering-recall-first-metrics：聚类该量覆盖率和事件完整率，甄别是 story-validation 的活；本节点讨论的正是『甄别』这一环节内部的取舍，不与该分工原则冲突）"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "cautions",
      "to": "lesson-llm-oversplits-single-large-event",
      "attributes": {
        "scope": "把这条『收紧验证提升精度』的取舍外推成『验证越严越好、拆分越细越好』时，在单一大事件的大簇上会撞见完全不同的失败模式——过细的拆分本身就是缺陷（91 篇报道被切成 22 个故事），不是可以无限换取的精度"
      }
    }
  ],
  "kind": "tradeoff",
  "invalidates_when": "若能找到一种收紧方式在同一批数据上同时提升事件召回与严精度（而不是此消彼长），则『二审必然拿召回换精度』这一结论对该收紧方式失效，需要具体到那种方式重新验证；目前的证据只支持『复核这一特定二审 prompt 设计』存在此取舍"
}
---

## 数字本身随架构死，取舍关系不死

[[experiment-story-validation-verify-stage-tradeoff]] 给出的具体数字
（103→74、98%→76%、75.7%→89.2%、53.3%→93.3%）绑定在这一版复核 prompt 与这一批数据上，
换 prompt、换判官模型，这些数字会变。但它们共同指向的关系——**候选生成阶段刻意放宽召回，
把『去伪』的责任交给专门的二审步骤，二审步骤越严格，精度提升的同时召回必然下降**——
是这类『生成→收紧』两段式管线的结构性质，不是某一版实现的偶然表现。

道理很直接：候选生成阶段判官本身允许一定误判空间（宽松找出所有可能的『同事件子集』），
二审的任务定义就是『抓住第一遍的过度合并』（storyValidation.ts 原文：「first pass is
known to over-merge... catch exactly that」）。既然二审的判定标准比第一遍更严，
它必然会把一部分第一遍判对的真实事件也当成误判撤销掉——严格标准不可能只筛掉假阳性
而不误伤真阳性，除非这个二审判官对『同一事件』的判断能力是完美的。这个结构在任何
『先宽后严』的两段式过滤管线里都成立，跟具体是新闻聚类还是别的领域无关。

## 什么时候『拿召回换精度』是净赚，什么时候不是

`storyValidation.ts` 给出的『净赚』结论是有前提的：下游 `maxStoriesToGenerate` 只消费
排序后的前 15 条，所以复核阶段召回的损失（98%→76%）主要落在本就进不了前 15 的低分故事上，
而前 15 条本身的精度反而从 53.3% 大幅提升到 93.3%。**如果下游改成消费全部通过项**
（例如某天新闻量小、通过的故事数不足 15），复核阶段丢掉的近四分之一真实事件就会
直接变成漏报，'净赚'的判断就会反转。这个前提本身也不是架构无关的常量，任何要复用
这条经验的场景都需要先确认自己的下游消费方式是否也是『只取排序后前 K 条』。

## 关联

来自 [[experiment-story-validation-verify-stage-tradeoff]]。本节点对
[[lesson-llm-oversplits-single-large-event]] 有一条警示关系——不要把本节点的『收紧=精度换召回』
误读为『拆得越细越好』，单一大事件的大簇上过细拆分本身就是失败模式，与这里讨论的
『二审严格度』不是同一个维度。用户 memory 中的 `storyvalidation-known-issues`
另记录了同一环节三个尚未修复的问题（伞状糊/maxTokens 打满复读/调用失败伪装成
NO_STORIES），与本节点讨论的精度/召回取舍是互补但独立的问题。
