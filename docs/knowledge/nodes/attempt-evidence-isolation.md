---
{
  "id": "attempt-evidence-isolation",
  "type": "attempt",
  "title": "按完全相同证据包隔离原子核验",
  "date": "2026-09-17",
  "status": "tested",
  "tasks": [
    "治事实关系错",
    "演化组合架构"
  ],
  "scope": "仅 c36 开发样本；未使用 heldout，不代表完整组合或生产验收",
  "source": "eval/cluster-to-brief/arms/atomic-evidence/GOAL.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "evaluated_by",
      "to": "experiment-isolation-eight"
    },
    {
      "type": "evaluated_by",
      "to": "experiment-isolation-expanded"
    },
    {
      "type": "evaluated_by",
      "to": "experiment-isolation-v5"
    },
    {
      "type": "contains",
      "to": "mechanism-evidence-isolation"
    },
    {
      "type": "addresses",
      "to": "goal-cluster-to-brief"
    }
  ],
  "hypothesis": "限制每个核验调用只能接触所有当前原子共同声明的证据",
  "changes": "从整批/父句分批改为相同证据坐标分组",
  "reason": "减少跨项借证据",
  "next_unknown": "扩展样本后是否仍减少误杀与漏判",
  "verification": "development"
}
---

限制每个核验调用只能接触所有当前原子共同声明的证据
