---
{
  "id": "mechanism-evidence-isolation",
  "type": "mechanism",
  "title": "相同证据包隔离接口",
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
      "to": "measure-evidence-bundle-isolation"
    }
  ],
  "input": "原子及继承的原始证据坐标",
  "output": "只共享同一证据包的核验任务",
  "limits": "八句局部有效、扩展失败；隔离不是充分语义安全保证",
  "invalidates_when": "八句局部有效、扩展失败；隔离不是充分语义安全保证",
  "verification": "development_signal_only"
}
---

八句局部有效、扩展失败；隔离不是充分语义安全保证
