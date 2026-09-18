---
{
  "id": "falsified-rarr-default-on",
  "title": "RARR 式「自动核对并改稿」默认开：78 条修改只落地 10 条，且核对依据是报告不是原文",
  "date": "2026-09-12",
  "status": "live",
  "source": "docs/adr/0004-brief-writer-v3.md",
  "invalidates_when": "核对改成直接对原句、且有独立于生成模型的判官（现在是同一档模型自审）",
  "type": "lesson",
  "tasks": [
    "治事实关系错",
    "设计验收门"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [
    "核对材料 = 报告层产出"
  ],
  "evidence_origin": "historical_document",
  "relations": [],
  "legacy_type": "falsified",
  "legacy_relations": {},
  "kind": "failure_or_literature_warning"
}
---
分段写那一轮：24 块提了 **78 条 edit，只落地 10 条**。两个结构性问题：核对依据是**报告**而不是原文，
所以报告里已有的错传不下去也纠不出来；prompt 式纠错精度天生低（调研：GPT-4 上 28.5%）。

另有实测：RARR 在**删有据内容**（43 次删除里 20 次误删），加 prompt 约束反而更差。
代码保留、默认关。现行做法是**只标记不改稿**（代码检查器），见 measure-detection-ceiling。
