---
{
  "id": "attempt-evidence-graph",
  "type": "attempt",
  "title": "evidence-graph 原型",
  "date": "2026-09-16",
  "status": "tested",
  "tasks": [
    "治事实关系错",
    "演化组合架构"
  ],
  "scope": "仅 c36 开发样本；未使用 heldout，不代表完整组合或生产验收",
  "source": "scripts/eval/cluster-to-brief/arms/evidence-graph/README.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "addresses",
      "to": "goal-cluster-to-brief"
    },
    {
      "type": "evaluated_by",
      "to": "experiment-evidence-graph-c36"
    }
  ],
  "hypothesis": "先提取原子观察，再以跨文章和跨发布者共识准入",
  "changes": "第一轮异质架构；不伪造三臂之间的派生关系",
  "reason": "测试不同职责与表示对覆盖/安全的影响",
  "next_unknown": "整体未达标后哪些机制可单独复用",
  "verification": "development"
}
---

先提取原子观察，再以跨文章和跨发布者共识准入

提炼后的分诊/支持排序职责见组合草案；不能将其当成此旧原型已经实现或验证的功能。
