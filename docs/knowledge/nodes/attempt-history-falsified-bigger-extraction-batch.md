---
{
  "id": "attempt-history-falsified-bigger-extraction-batch",
  "type": "attempt",
  "title": "历史尝试：抽取批大小 20→60：省 41–47% neurons，但召回真掉（−17%~−25%，满覆盖对照）",
  "date": "2026-09-14",
  "status": "historical",
  "tasks": [
    "降低报告层成本",
    "改抽取prompt"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "source": "apps/backend/prototypes/cost-split/out/REPORT.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "evaluated_by",
      "to": "experiment-history-falsified-bigger-extraction-batch"
    }
  ],
  "hypothesis": "历史干预与结果：抽取批大小 20→60：省 41–47% neurons，但召回真掉（−17%~−25%，满覆盖对照）",
  "changes": "从原节点复原的历史方案；相对基线的确切差异以正文/source 为准",
  "reason": "历史记录，不推断当时未记载的动机",
  "next_unknown": "下游（去重、写作层）被确认能容忍更高遗漏率，且有独立的召回护栏",
  "verification": "development"
}
---

历史干预与结果：抽取批大小 20→60：省 41–47% neurons，但召回真掉（−17%~−25%，满覆盖对照）
