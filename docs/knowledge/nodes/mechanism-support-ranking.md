---
{
  "id": "mechanism-support-ranking",
  "type": "mechanism",
  "title": "多源支持用于重要性排序，不作真假准入门",
  "date": "2026-09-17",
  "status": "candidate",
  "tasks": [
    "治事实关系错",
    "演化组合架构"
  ],
  "scope": "仅 c36 开发样本；未使用 heldout，不代表完整组合或生产验收",
  "source": "eval/cluster-to-brief/arms/atomic-evidence/DESIGN.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "justified_by",
      "to": "lesson-three-arm-tradeoff"
    }
  ],
  "input": "候选的文章与发布者支持信息",
  "output": "事件槽与候选排序",
  "limits": "支持度不是事实真伪；单源受证据完整支持的事实不应被直接淘汰",
  "invalidates_when": "支持度不是事实真伪；单源受证据完整支持的事实不应被直接淘汰",
  "verification": "development_signal_only"
}
---

支持度不是事实真伪；单源受证据完整支持的事实不应被直接淘汰
