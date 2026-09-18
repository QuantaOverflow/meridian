---
{
  "id": "attempt-history-falsified-dedup-candidate-tightening",
  "type": "attempt",
  "title": "历史尝试：收紧去重候选（top-8→5、余弦 0.70→0.75）：省 6% 成本，骨架事实掉 14%",
  "date": "2026-09-13",
  "status": "historical",
  "tasks": [
    "降低报告层成本",
    "改去重"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "source": "apps/backend/prototypes/brief-v3-prod/out/STOP.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "evaluated_by",
      "to": "experiment-history-falsified-dedup-candidate-tightening"
    }
  ],
  "hypothesis": "历史干预与结果：收紧去重候选（top-8→5、余弦 0.70→0.75）：省 6% 成本，骨架事实掉 14%",
  "changes": "从原节点复原的历史方案；相对基线的确切差异以正文/source 为准",
  "reason": "历史记录，不推断当时未记载的动机",
  "next_unknown": "骨架的定义不再依赖跨文章合并，或有了不靠余弦的候选生成方式",
  "verification": "development"
}
---

历史干预与结果：收紧去重候选（top-8→5、余弦 0.70→0.75）：省 6% 成本，骨架事实掉 14%
