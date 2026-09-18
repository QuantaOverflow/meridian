---
{
  "id": "measure-report-cost-structure",
  "title": "成本 85% 在报告层；其内部抽取 50% / 去重 37% / 各方 13%，且 ≈ 56 neurons × 篇数",
  "date": "2026-09-13",
  "status": "live",
  "source": "apps/backend/prototypes/brief-v3-prod/out/STOP.md",
  "invalidates_when": "换模型、换分批大小，或抽取/去重的调用结构改变",
  "type": "lesson",
  "tasks": [
    "降低报告层成本"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "constrained_by",
      "to": "invariant-support-count"
    }
  ],
  "legacy_type": "measurement",
  "legacy_relations": {
    "depends_on": [
      "invariant-support-count"
    ]
  },
  "kind": "observation"
}
---
一期简报 20,302 neurons：报告层 ≈17,257（85%），写作层 ≈3,045（15%，含零调用的检查器）。
报告层内部：抽取 ≈50%、去重 ≈37%、各方与分歧 ≈13%。

跨 25 个簇线性拟合：**每簇 report neurons ≈ 56 × 该簇文章数**（截距 −39）。
所以成本几乎完全由「这条新闻读了几篇、多长」决定——这也是所有降本方案都盯着输入的原因，
而「成本是否真由输入撑」直到 2026-09-14 才被单独验（见 claim-output-bound-cost）。
