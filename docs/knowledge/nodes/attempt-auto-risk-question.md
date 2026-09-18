---
{
  "id": "attempt-auto-risk-question",
  "type": "attempt",
  "title": "自由生成风险问题规划",
  "date": "2026-09-17",
  "status": "tested",
  "tasks": [
    "治事实关系错",
    "演化组合架构"
  ],
  "scope": "仅 c36 开发样本；未使用 heldout，不代表完整组合或生产验收",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/AUTO-RISK-RESULT.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "varies_from",
      "to": "attempt-specialist-risk",
      "attributes": {
        "changed": "问题来源从人工变为只看候选文本的模型",
        "reason": "检验手工开发信号能否成为自动架构"
      }
    },
    {
      "type": "evaluated_by",
      "to": "experiment-auto-risk-four"
    },
    {
      "type": "addresses",
      "to": "goal-cluster-to-brief"
    }
  ],
  "hypothesis": "模型从候选文本自动生成独立且完整的窄问题",
  "changes": "将手工风险问题替换为自由生成问题",
  "reason": "手工接口有信号但不适用于自动生产",
  "next_unknown": "受约束风险槽能否保留时间方向与归因作用域",
  "verification": "development"
}
---

模型从候选文本自动生成独立且完整的窄问题
