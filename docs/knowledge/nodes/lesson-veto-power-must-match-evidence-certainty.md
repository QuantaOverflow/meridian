---
{
  "id": "lesson-veto-power-must-match-evidence-certainty",
  "type": "lesson",
  "title": "单票否决权要配得上证据的确定性：LLM 单条判决不配，代码坐实的硬冲突才配",
  "date": "2026-07-11",
  "status": "recorded",
  "tasks": ["治事实关系写错", "设计验收门"],
  "scope": "任何『多条独立判定汇总成一个整体通过/拒绝决策』的验收门场景，判定来源既包含 LLM 判官又包含确定性代码比对",
  "source": "services/meridian-ai-worker/src/services/faithfulness-check.ts:14-19, 24-28, 128-138",
  "conditions": [
    "本结论的两条证据分别来自不同性质的判定：LLM 单条 claim 判决（noisy，held-out 12 条误拦 2/12）与代码坐实的数值/日期区间比对（deterministic，精度 0.833~1.0）",
    "『单票否决』特指某一类判定只要出现 1 次就否决整个产出，不区分该判定的置信度来源"
  ],
  "evidence_origin": "local_record",
  "relations": [],
  "kind": "tradeoff",
  "invalidates_when": "换一种判定来源后，若能证明某类『非确定性』判定的单条错误率也能压到与确定性证据同一量级（本节点的参照锚点是 extract-compare 通道的 0.833~1.0 精度），则该类判定也可以被给予单票否决权——需要新的精度实测支撑，不能凭直觉放开"
}
---

## 两条独立证据指向同一个设计原则

[[experiment-faithfulness-single-vote-veto-risk]]：LLM 单条 claim 判决用于一票否决时，
12 条 held-out 里 2 条被误拦（17%），且误拦可稳定复现（RUNS=5 确定型）——单条噪声判决
被放大成整篇简报的生杀权。

[[experiment-extract-compare-code-verified-precision]]：同样是『单条即拦』，但依据换成
LLM 只做抽取（逐字引用、禁算术）+ 代码做确定性比对（区间相交）产出的硬冲突后，
精度实测 0.833~1.0，且两个数据集上都是『修 3 弄坏 0』——单票否决在这里没有放大噪声，
因为被否决的依据本身噪声很低。

## 为什么这是一条不随架构死的设计原则

差别不在『单票否决』这个机制本身好不好，而在于**否决权的强度必须匹配它所依据的证据的
确定性**。LLM 给出的单条判决，即便来自『可信通道』（factual κ=0.76），个体判决仍然带有
不可忽略的噪声，不能单独承担整体否决的责任；只有当证据来源本身是确定性的（代码比对，
没有『判官抽风』这个自由度）时，单票否决才不会把噪声放大成误伤。这个原则适用于任何
『LLM 判官 + 汇总门槛』的验收系统设计，与具体是不是忠实度检查无关。

`faithfulness-check.ts` 的门 F 判据正是这条原则的具体实现：(A)(B) 两条给 LLM 判决用占比
+绝对量双阈做减震（`GATE_CONTRADICTED_RATE=0.05`、`GATE_CONTRADICTED_MIN_COUNT=2`、
`GATE_UNSUPPORTED_RATE=0.15`、`GATE_UNSUPPORTED_MIN_COUNT=4`，见同文件 129-135 行），
(C) 单独给代码坐实的硬冲突开单票口子（`GATE_CODE_CONFLICT_MIN_COUNT=1`）。

## 关联

被 [[mechanism-tiered-veto-gate]] 采纳为核心设计依据。
