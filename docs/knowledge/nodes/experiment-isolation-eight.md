---
{
  "id": "experiment-isolation-eight",
  "type": "experiment",
  "title": "证据隔离：八句探针",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": [
    "治事实关系错",
    "演化组合架构"
  ],
  "scope": "仅 c36 开发样本；未使用 heldout，不代表完整组合或生产验收",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/GOAL.md",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "yields",
      "to": "measure-evidence-bundle-isolation"
    }
  ],
  "kind": "probe",
  "outcome": "passed",
  "inputs": "c36 冻结的四个硬错、四个正常句及九个最小对照",
  "evaluation": "预声明坏句拦截与正常对照误杀；评测不能由被测 gate 自证",
  "result": "4 个坏句均拦到坏原子，4 个正常对照零误杀；另有九个最小对照通过",
  "cost": "八句探针：12 次证据包调用，9290 input / 2197 output tokens，100.7 秒",
  "record_completeness": "complete"
}
---

4 个坏句均拦到坏原子，4 个正常对照零误杀；另有九个最小对照通过
