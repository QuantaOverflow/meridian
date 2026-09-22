---
{
  "id": "mechanism-raw-candidate-discovery",
  "type": "mechanism",
  "title": "原文高召回候选发现",
  "date": "2026-09-17",
  "status": "candidate",
  "tasks": [
    "治事实关系错",
    "演化组合架构"
  ],
  "scope": "仅 c36 开发样本；未使用 heldout，不代表完整组合或生产验收",
  "source": "eval/cluster-to-brief/arms/direct-raw/README.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "justified_by",
      "to": "lesson-three-arm-tradeoff"
    }
  ],
  "input": "全部文章及句级出处",
  "output": "候选文本与原始出处",
  "limits": "来自 direct-raw 整体覆盖信号；单独组件与组合中的覆盖能力尚未验证",
  "invalidates_when": "来自 direct-raw 整体覆盖信号；单独组件与组合中的覆盖能力尚未验证",
  "verification": "development_signal_only"
}
---

来自 direct-raw 整体覆盖信号；单独组件与组合中的覆盖能力尚未验证
