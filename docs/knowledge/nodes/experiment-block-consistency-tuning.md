---
{
  "id": "experiment-block-consistency-tuning",
  "type": "experiment",
  "title": "块间数值一致性传感器：第 75 期实测精度 3/4，加块标题后召回涨但精度从 2/2 掉到 3/6，补地点消歧才回到 3/4",
  "date": "2026-09-01",
  "status": "recorded",
  "tasks": ["治事实关系写错"],
  "scope": "block-consistency.ts，分段写（b′）架构下的块间数值互相矛盾检测；纯字符串处理，零 LLM 调用；覆盖 money/killed/missing/injured/rescued/percent/magnitude 七类量纲",
  "source": "services/meridian-ai-worker/src/utils/block-consistency.ts:1-22（文件头注释）",
  "conditions": [
    "n=75 指的是仅第 75 期简报一天的数据，样本量极小，文件注释自陈『精度实测 3/4，别当成准确率』",
    "PLACES 是在这一天数据上手工调出来的固定地名词表（nepal/tibet/china/...），换一天的新闻话题会漂",
    "该传感器 mark-only：只报不改，不接入拦截"
  ],
  "evidence_origin": "local_record",
  "relations": [
    { "type": "yields", "to": "lesson-block-consistency-structural-blind-spot" }
  ],
  "kind": "probe",
  "outcome": "mixed",
  "inputs": "第 75 期简报正文，按 `<u>**title**</u>` 切回块，抽取金额/伤亡/百分比/震级四类量化表达做块间配对比对",
  "evaluation": "人工核对该期检出的冲突条目，统计精度；同时记录每次调参（加块标题进主题键、补地点消歧）前后的召回与精度变化",
  "result": "首轮实测 6 处检出、3 处误报，全部因未做地点消歧（同一场灾害跨辖区，如尼泊尔 644 失踪 vs 西藏 558 失踪，被误判为同一数字冲突）。把块标题并入主题键以提升召回后，精度从 2/2 掉到 3/6。补地点消歧后精度回到 3/4。最终态：精度 3/4，覆盖四类量纲，漏检不代表没冲突。",
  "cost": "零 LLM 调用，纯字符串处理，无额外成本",
  "record_completeness": "summary_only"
}
---

## 读数原文

`block-consistency.ts:14-21`：

> ⚠️ 已知局限，别当成准确率：
>   · 只覆盖四类量纲，漏检不代表没冲突
>   · 精度实测 3/4（第 75 期一天的数据，n 很小）
>   · PLACES 是在那一天的数据上调出来的固定词表，换一天会漂——地点消歧靠它，
>     词表没覆盖的辖区会退化成误报（不是漏检）。mark-only 下误报只是噪声。
>
> 调这把尺时的教训：加块标题进主题键后召回涨、精度从 2/2 掉到 3/6，补地点消歧才回到 3/4。
> **召回涨了就收工是错的。**

## 关联

产生 [[lesson-block-consistency-structural-blind-spot]]。与
[[lesson-llm-oversplits-single-large-event]] 描述的是同一类『同一事件跨地域/跨辖区报道』
现象在不同环节的表现：那条经验讲的是聚类/故事切分层面的碎片化，这里讲的是写作层
分段写之后，同一场灾害的两个辖区各自数字被写作模块误判为『自相矛盾』。
