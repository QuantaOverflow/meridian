---
{
  "id": "experiment-auto-risk-four",
  "type": "experiment",
  "title": "自动风险问题规划：四句开发探针",
  "date": "2026-09-17",
  "status": "recorded",
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
      "type": "yields",
      "to": "measure-auto-risk-question-drift"
    }
  ],
  "kind": "probe",
  "outcome": "failed",
  "inputs": "四个 c36 候选；规划器不见证据、标签与人工问题",
  "evaluation": "代码校验结构；Codex 检查完整性、独立性与含义保持",
  "result": "重复整句与同义时序问题，after 被改成 cause；语义接口失败，未运行下游 specialist",
  "cost": "首次有效调用 15.70 秒，336 input / 526 output tokens",
  "record_completeness": "complete"
}
---

重复整句与同义时序问题，after 被改成 cause；语义接口失败，未运行下游 specialist
