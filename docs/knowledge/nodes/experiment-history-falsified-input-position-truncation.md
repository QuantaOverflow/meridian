---
{
  "id": "experiment-history-falsified-input-position-truncation",
  "type": "experiment",
  "title": "历史证据摘要：位置截断选材（核心 4 篇全文 + 其余前 5 句）：省 57.7% 调用，主簇召回 11/13→6/13",
  "date": "2026-09-14",
  "status": "recorded",
  "tasks": [
    "降低报告层成本"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "source": "apps/backend/prototypes/brief-v3-prod/out/input-selection-spike.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "yields",
      "to": "falsified-input-position-truncation"
    }
  ],
  "kind": "retrospective_analysis",
  "outcome": "observed",
  "inputs": "输入范围见原经验正文；准确运行清单未从历史节点恢复",
  "evaluation": "沿用原文中的读数与判据；不宣称独立复评",
  "result": "位置截断选材（核心 4 篇全文 + 其余前 5 句）：省 57.7% 调用，主簇召回 11/13→6/13",
  "cost": "未从证据中确定，不补写估算",
  "record_completeness": "summary_only"
}
---

位置截断选材（核心 4 篇全文 + 其余前 5 句）：省 57.7% 调用，主簇召回 11/13→6/13

这是迁移时建立的证据摘要，不是新增执行。原始结论正文仍在 falsified-input-position-truncation；模型配置、prompt/code/data 版本和调用次数若未记载，均为未知。
