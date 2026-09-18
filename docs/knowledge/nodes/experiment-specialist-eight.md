---
{
  "id": "experiment-specialist-eight",
  "type": "experiment",
  "title": "人工窄问题与全维度检查：八例对照",
  "date": "2026-09-17",
  "status": "recorded",
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
      "type": "yields",
      "to": "measure-specialist-risk-gate"
    }
  ],
  "kind": "probe",
  "outcome": "mixed",
  "inputs": "四个已知风险负例与四个正常对照；问题手工编写",
  "evaluation": "Codex 会话读取冻结原文判定；非盲评、非多人标注",
  "result": "specialist 漏判 0/4、误杀 0/4；alignment 漏判 0/4、误杀 2/4",
  "cost": "两路线共五次成功 HTTP 调用，3282 input / 4542 output tokens，91.02 秒；包含格式失败与记录在案的省略号恢复",
  "record_completeness": "complete"
}
---

specialist 漏判 0/4、误杀 0/4；alignment 漏判 0/4、误杀 2/4
