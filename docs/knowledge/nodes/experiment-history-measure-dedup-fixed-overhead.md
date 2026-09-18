---
{
  "id": "experiment-history-measure-dedup-fixed-overhead",
  "type": "experiment",
  "title": "历史证据摘要：去重 95.3% 的输入是重复贴的同一段判定说明书（125 次调用只判 453 条事实，平均 3.62 条/次）",
  "date": "2026-09-15",
  "status": "recorded",
  "tasks": [
    "降低报告层成本",
    "改去重"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "source": "apps/backend/prototypes/brief-v3-prod/out/runs/M1-1789308830116/（四簇 observation spans，离线统计）",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "yields",
      "to": "measure-dedup-fixed-overhead"
    }
  ],
  "kind": "retrospective_analysis",
  "outcome": "observed",
  "inputs": "输入范围见原经验正文；准确运行清单未从历史节点恢复",
  "evaluation": "沿用原文中的读数与判据；不宣称独立复评",
  "result": "去重 95.3% 的输入是重复贴的同一段判定说明书（125 次调用只判 453 条事实，平均 3.62 条/次）",
  "cost": "未从证据中确定，不补写估算",
  "record_completeness": "summary_only"
}
---

去重 95.3% 的输入是重复贴的同一段判定说明书（125 次调用只判 453 条事实，平均 3.62 条/次）

这是迁移时建立的证据摘要，不是新增执行。原始结论正文仍在 measure-dedup-fixed-overhead；模型配置、prompt/code/data 版本和调用次数若未记载，均为未知。
