---
{
  "id": "experiment-isolation-expanded",
  "type": "experiment",
  "title": "证据隔离：30 句扩展",
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
  "inputs": "30 句 c36 开发样本，含 26 个正常对照",
  "evaluation": "预声明坏句拦截与正常对照误杀；评测不能由被测 gate 自证",
  "result": "26 个正常对照中 4 句被拒；不能推广八句结果",
  "cost": "本条摘要未确定完整调用成本",
  "record_completeness": "complete"
}
---

26 个正常对照中 4 句被拒；不能推广八句结果
