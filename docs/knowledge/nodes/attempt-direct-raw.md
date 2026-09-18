---
{
  "id": "attempt-direct-raw",
  "type": "attempt",
  "title": "direct-raw 原型",
  "date": "2026-09-16",
  "status": "tested",
  "tasks": [
    "治事实关系错",
    "演化组合架构"
  ],
  "scope": "仅 c36 开发样本；未使用 heldout，不代表完整组合或生产验收",
  "source": "scripts/eval/cluster-to-brief/arms/direct-raw/README.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "addresses",
      "to": "goal-cluster-to-brief"
    },
    {
      "type": "evaluated_by",
      "to": "experiment-direct-raw-c36"
    },
    {
      "type": "contains",
      "to": "mechanism-raw-candidate-discovery"
    }
  ],
  "hypothesis": "全量原文窗口产生高召回候选，再按 ID 选材与确定性组装",
  "changes": "第一轮异质架构；不伪造三臂之间的派生关系",
  "reason": "测试不同职责与表示对覆盖/安全的影响",
  "next_unknown": "整体未达标后哪些机制可单独复用",
  "verification": "development"
}
---

全量原文窗口产生高召回候选，再按 ID 选材与确定性组装
