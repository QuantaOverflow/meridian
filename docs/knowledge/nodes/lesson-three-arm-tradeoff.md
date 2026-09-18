---
{
  "id": "lesson-three-arm-tradeoff",
  "type": "lesson",
  "title": "三臂在 c36 都未达标：覆盖与证据约束的职责需要分离",
  "date": "2026-09-16",
  "status": "recorded",
  "tasks": [
    "治事实关系错",
    "演化组合架构"
  ],
  "scope": "仅 c36 开发样本；未使用 heldout，不代表完整组合或生产验收",
  "source": "scripts/eval/cluster-to-brief/out/slow-direct-raw-dev.json; scripts/eval/cluster-to-brief/out/slow-structure-router-dev.json; scripts/eval/cluster-to-brief/out/slow-evidence-graph-dev.json",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "motivates",
      "to": "attempt-evidence-isolation"
    }
  ],
  "kind": "tradeoff",
  "invalidates_when": "新机制或样本改变后，需重新比较覆盖与事实错"
}
---

direct-raw 6/7 核心、hard=4；structure-router 1/7、hard=0；evidence-graph 0/7、hard=0。局部优势只构成机制提炼假设，不能由整体对照直接归因到单一组件。
