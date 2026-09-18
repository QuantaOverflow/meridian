---
{
  "id": "mechanism-specialist-question-gate",
  "type": "mechanism",
  "title": "单风险问题核验接口",
  "date": "2026-09-17",
  "status": "candidate",
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
      "type": "justified_by",
      "to": "measure-specialist-risk-gate"
    }
  ],
  "input": "一个明确风险问题、候选断言与原文",
  "output": "逐字证据锚点及对该风险的判断",
  "limits": "仅人工问题八例信号；自动风险识别、完备性与多风险聚合未验证",
  "invalidates_when": "仅人工问题八例信号；自动风险识别、完备性与多风险聚合未验证",
  "verification": "development_signal_only"
}
---

仅人工问题八例信号；自动风险识别、完备性与多风险聚合未验证
