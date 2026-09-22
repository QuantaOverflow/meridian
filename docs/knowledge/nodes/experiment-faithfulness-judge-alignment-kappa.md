---
{
  "id": "experiment-faithfulness-judge-alignment-kappa",
  "type": "experiment",
  "title": "忠实度判官与人工的一致性：事实通道 κ=0.76 可用，分析通道 κ=0.27（contradicts_facts 召回仅 0.30）不可用",
  "date": "2026-06-16",
  "status": "recorded",
  "tasks": ["治事实关系写错", "设计验收门"],
  "scope": "judge 模型 qwen-max（与标定同模型，换模型会让本结果与下游 0.15/4、0.05/2 阈值一并失效）；判定对象是 faithfulness-check.ts 的两条判决通道——factual（supported/unsupported/contradicted）与 analytical（consistent/contradicts_facts）",
  "source": "services/meridian-ai-worker/src/services/faithfulness-check.ts:30-32（文件头注释：【红线】段落）",
  "conditions": [
    "样本量、评分者数量、具体 meta-eval 脚本路径未在本文件中给出，本节点只转述注释里的结论数字，标记为未知",
    "analytical 通道的召回具体指 contradicts_facts 这一类判定的召回，即 judge 把 70% 的『虚构前提』analytical claim 误判为 consistent"
  ],
  "evidence_origin": "local_record",
  "relations": [
    { "type": "yields", "to": "lesson-analytical-verdict-not-gateable" }
  ],
  "kind": "probe",
  "outcome": "mixed",
  "inputs": "同一批 brief 产出的 factual claim 判决与 analytical claim 判决，与人工复核标注对照（meta-eval，2026-06-16）",
  "evaluation": "Cohen's κ（judge verdict vs 人工标注），并单独统计 analytical 通道 contradicts_facts 这一判定值的召回率",
  "result": "事实通道（factual：supported/unsupported/contradicted）κ=0.76，可信。分析通道（analytical：consistent/contradicts_facts）κ=0.27，且 contradicts_facts 召回仅 0.30——即 70% 的『分析建立在虚构前提上』的真阳性被 judge 放过判成 consistent。",
  "cost": "未知（注释未记录调用次数或费用）",
  "record_completeness": "summary_only"
}
---

## 读数原文

`faithfulness-check.ts:30-32`：

> 【红线】analytical verdict 永不可用于 gate/revision。2026-06-16 meta-eval 实测分析通道
> κ=0.27（contradicts_facts 召回仅 0.30，judge 放过 70% 虚构前提）——这把尺不可信。事实
> 通道 κ=0.76 可信，门拦截只键在事实。

## 这条结论已经产生的直接后果

代码层面的结论已经落地：`FaithfulnessVerdict` 里 `analytical_consistent` /
`analytical_contradicting` 字段明确注释为「次级信号，warning-only」（同文件 109-111 行），
`gateDecision()`（同文件 490-521 行）完全不读 analytical 判决，只用 factual 通道的
contradicted / unsupported 计数决定 block。

## 与 [[lesson-analytical-verdict-not-gateable]] 的关系

本实验是该经验的直接证据来源。经验条目把这条读数从「这一版忠实度门的表现」提升为
「判断可验证事实 vs 判断分析性论断，是两个难度完全不同的人机对齐任务」这一更一般的结论。
