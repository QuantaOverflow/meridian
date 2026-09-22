---
{
  "id": "mechanism-tiered-veto-gate",
  "type": "mechanism",
  "title": "分层门控：按证据确定性分级——LLM 噪声判定用占比+绝对量双阈，确定性证据才给单票否决",
  "date": "2026-07-11",
  "status": "historical",
  "tasks": ["治事实关系写错", "设计验收门"],
  "scope": "faithfulness-check.ts 的门 F（gateDecision()）；线上默认 mode=code_only，只走确定性通道；mode=full 才会产出 LLM 判决但仍不改变门槛设计",
  "source": "services/meridian-ai-worker/src/services/faithfulness-check.ts:14-19, 128-138, 490-521（gateDecision 实现）",
  "conditions": [
    "阈值具体数值（0.05/2、0.15/4、code_verified 单票门槛 1）是在 judge=qwen-max 下标定的，换模型需要重新标定，见 lesson-analytical-verdict-not-gateable 的 invalidates_when",
    "2026-07-11 之后线上默认 mode=code_only：LLM 判官整体撤出线上门控，只在离线批跑当预筛；本机制描述的是判据设计本身，不代表当前线上是否真的会触发 (A)(B) 两条（code_only 下 unsupported 恒 0，判据实际由 (C) 主导，见文件 21-22 行）"
  ],
  "evidence_origin": "local_record",
  "relations": [
    { "type": "justified_by", "to": "lesson-veto-power-must-match-evidence-certainty" },
    { "type": "justified_by", "to": "lesson-analytical-verdict-not-gateable" }
  ],
  "input": "一组判定结果，每条判定附带证据确定性标签——分析性判定（analytical，LLM 判官，噪声高、不可对齐）/ 事实性判定（factual，LLM 判官，噪声中等）/ 代码坐实判定（code_verified，确定性比对，噪声低）",
  "output": "block / pass 二元决策 + block_reasons 明细；analytical 判定完全不参与决策，只作为 warning-only 附带信息",
  "limits": "① 只解决『同一批判定内部证据确定性不均』的问题，不能替代提高单条判定本身的精度；② 三档阈值都是对当前判官模型的经验标定，不是可推导的理论值，模型或 prompt 换了必须重新标定，否则会继续用旧阈值放行新模型下已经变了性质的判定分布；③ 依赖存在一条可信的确定性证据子通道（如 extract-compare）——没有这条子通道时，分层门控退化为『LLM 判定用双阈、没有单票口子』，仍然优于统一单票，但灵敏度会打折（文件 27 行原文承认『单条真矛盾暂会漏判』）",
  "invalidates_when": "换判官模型或判定 schema 后，若能证明 LLM 单条判决的精度已经接近确定性证据的量级（本节点参照的锚点区间是 0.833~1.0），分层的必要性下降，可以考虑合并阈值；反之若确定性子通道本身精度下滑到接近 LLM 判决水平，该子通道的单票资格需要撤销重新走双阈"
}
---

## 设计的三层结构

1. **analytical 通道**：完全不参与门控（[[lesson-analytical-verdict-not-gateable]] 的直接应用）——判定难度本身对不齐人工，给它否决权只会放大对齐误差。
2. **factual 通道（LLM 判官）**：占比+绝对量双阈——`contradicted`（矛盾）用 `count>=2 且 rate>=0.05`，`unsupported`（无源脑补）用 `count>=4 且 rate>0.15`。双阈的作用是防止单条噪声判决单独触发拦截（见 [[experiment-faithfulness-single-vote-veto-risk]]）。
3. **code_verified 通道（代码坐实）**：单票即拦（`count>=1`）。因为这条证据的精度（0.833~1.0，见 [[experiment-extract-compare-code-verified-precision]]）已经高到不需要靠聚合来减震。

## 为什么值得作为可复用机制单独记录

这不是一份"忠实度检查专用配方"，而是**任何『多来源判定汇总成一个通过/拒绝决策』的系统**
都会遇到的结构：不同判定来源的置信度天然不齐（人工规则、LLM 判官、确定性代码比对），
把它们塞进同一个阈值会让高置信度证据被过度稀释、低置信度证据被过度信任。分层给不同
确定性等级配不同的否决权重，是这类系统的通用做法（业界对应的是集成学习里"按基学习器
置信度加权"的思路，这里简化成了三档离散权重）。

## 局限：这是标定结果，不是可推导的公式

三个阈值数字本身完全是标定出来的经验值，换模型、换判定粒度都需要重新走一遍
[[experiment-faithfulness-single-vote-veto-risk]] 那样的 held-out 实测流程才能定下新阈值——
机制可复用的是"分三层、按证据确定性配否决权"这个结构，不是 `0.05/2`、`0.15/4` 这两组具体数字。
