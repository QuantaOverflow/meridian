---
{
  "id": "falsified-dedup-candidate-tightening",
  "title": "收紧去重候选（top-8→5、余弦 0.70→0.75）：省 6% 成本，骨架事实掉 14%",
  "date": "2026-09-13",
  "status": "live",
  "source": "apps/backend/prototypes/brief-v3-prod/out/STOP.md",
  "invalidates_when": "骨架的定义不再依赖跨文章合并，或有了不靠余弦的候选生成方式",
  "type": "lesson",
  "tasks": [
    "降低报告层成本",
    "改去重"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [
    "骨架 = 被 ≥2 篇报道",
    "清单召回不能掉"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "constrained_by",
      "to": "invariant-support-count"
    }
  ],
  "legacy_type": "falsified",
  "legacy_relations": {
    "supports": [
      "method-two-fighting-readings"
    ],
    "depends_on": [
      "invariant-support-count"
    ]
  },
  "kind": "failure_or_literature_warning"
}
---
四簇 neurons 2,340→2,202（−6%），但骨架事实 66→57（−14%，c13 从 22 掉到 15），
且 c3 出现两条逐字相同、分属两篇文章却没并起来的事实（本该合成一条 ≥2 篇的骨架）。已回退。

**关键教训**：已知事实召回**一条没掉**（c0 12/13、c18 22/30），完全看不出这个伤——
召回只问「事实在不在」，不问「跨文章有没有并起来」。能看见的是骨架数。
