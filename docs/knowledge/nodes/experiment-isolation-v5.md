---
{
  "id": "experiment-isolation-v5",
  "type": "experiment",
  "title": "证据隔离：聚焦 v5",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": [
    "治事实关系错",
    "演化组合架构"
  ],
  "scope": "仅 c36 开发样本；未使用 heldout，不代表完整组合或生产验收",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/GOAL.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "yields",
      "to": "measure-evidence-bundle-isolation"
    }
  ],
  "kind": "probe",
  "outcome": "failed",
  "inputs": "c36 聚焦开发对照",
  "evaluation": "预声明坏句拦截与正常对照误杀；评测不能由被测 gate 自证",
  "result": "正常对照 2/4 被拒，且漏判错误归因和时序",
  "cost": "本条摘要未确定完整调用成本",
  "record_completeness": "complete"
}
---

正常对照 2/4 被拒，且漏判错误归因和时序
