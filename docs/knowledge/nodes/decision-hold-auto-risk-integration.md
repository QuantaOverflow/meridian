---
{
  "id": "decision-hold-auto-risk-integration",
  "type": "decision",
  "title": "暂缓自由问题 planner 与 specialist 融合",
  "date": "2026-09-17",
  "status": "accepted",
  "tasks": [
    "治事实关系错",
    "演化组合架构"
  ],
  "scope": "仅 c36 开发样本；未使用 heldout，不代表完整组合或生产验收",
  "source": "eval/cluster-to-brief/arms/atomic-evidence/AUTO-RISK-RESULT.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "based_on",
      "to": "experiment-auto-risk-four"
    },
    {
      "type": "based_on",
      "to": "measure-specialist-risk-gate"
    },
    {
      "type": "selects",
      "to": "attempt-auto-risk-question",
      "attributes": {
        "action": "hold"
      }
    },
    {
      "type": "selects",
      "to": "attempt-constrained-risk-slots",
      "attributes": {
        "action": "next_experiment_only"
      }
    }
  ],
  "action": "暂缓自由 planner 融合；下一轮验证受约束风险槽",
  "invalidates_when": "新规划表示通过必要风险、独立性与含义保持对照后重评"
}
---

人工窄问题八例信号保留；自动规划语义接口失败，组合不能因此升级为通过。
