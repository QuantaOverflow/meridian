---
{
  "id": "attempt-history-falsified-input-position-truncation",
  "type": "attempt",
  "title": "历史尝试：位置截断选材（核心 4 篇全文 + 其余前 5 句）：省 57.7% 调用，主簇召回 11/13→6/13",
  "date": "2026-09-14",
  "status": "historical",
  "tasks": [
    "降低报告层成本"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "source": "apps/backend/prototypes/brief-v3-prod/out/input-selection-spike.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "evaluated_by",
      "to": "experiment-history-falsified-input-position-truncation"
    }
  ],
  "hypothesis": "历史干预与结果：位置截断选材（核心 4 篇全文 + 其余前 5 句）：省 57.7% 调用，主簇召回 11/13→6/13",
  "changes": "从原节点复原的历史方案；相对基线的确切差异以正文/source 为准",
  "reason": "历史记录，不推断当时未记载的动机",
  "next_unknown": "核心文章数改成随簇大小自适应（而非固定 4 篇），或支持数不再依赖跨文章计数",
  "verification": "development"
}
---

历史干预与结果：位置截断选材（核心 4 篇全文 + 其余前 5 句）：省 57.7% 调用，主簇召回 11/13→6/13
