---
{
  "id": "attempt-specialist-risk",
  "type": "attempt",
  "title": "人工窄风险问题核验",
  "date": "2026-09-17",
  "status": "tested",
  "tasks": [
    "治事实关系错",
    "演化组合架构"
  ],
  "scope": "仅 c36 开发样本；未使用 heldout，不代表完整组合或生产验收",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/RISK-RESULT.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "varies_from",
      "to": "attempt-evidence-isolation",
      "attributes": {
        "changed": "核验接口从通用完整支持检查变成手工给定的单风险问题",
        "reason": "隔离后仍误杀和漏判，需要更明确的任务边界"
      }
    },
    {
      "type": "evaluated_by",
      "to": "experiment-specialist-eight"
    },
    {
      "type": "contains",
      "to": "mechanism-specialist-question-gate"
    },
    {
      "type": "addresses",
      "to": "goal-cluster-to-brief"
    }
  ],
  "hypothesis": "用明确单风险问题代替自由全维度展开，减少假维度误杀",
  "changes": "问题由人工提供，仅判定声明的风险点",
  "reason": "全维度检查会给正常事实添加不适用的判定标准",
  "next_unknown": "自动问题规划是否能生成完整且无新前提的窄问题",
  "verification": "development"
}
---

用明确单风险问题代替自由全维度展开，减少假维度误杀
