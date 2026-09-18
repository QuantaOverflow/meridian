---
{
  "id": "falsified-input-position-truncation",
  "title": "位置截断选材（核心 4 篇全文 + 其余前 5 句）：省 57.7% 调用，主簇召回 11/13→6/13",
  "date": "2026-09-14",
  "status": "live",
  "source": "apps/backend/prototypes/brief-v3-prod/out/input-selection-spike.md",
  "invalidates_when": "核心文章数改成随簇大小自适应（而非固定 4 篇），或支持数不再依赖跨文章计数",
  "type": "lesson",
  "tasks": [
    "降低报告层成本"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [
    "每篇都要读到才能数支持数",
    "引用要可解析",
    "清单召回不能掉"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "cautions",
      "to": "claim-inverted-pyramid",
      "attributes": {
        "scope": "位置截断选材（核心 4 篇全文 + 其余前 5 句）：省 57.7% 调用，主簇召回 11/13→6/13；成立条件见正文，失效条件：核心文章数改成随簇大小自适应（而非固定 4 篇），或支持数不再依赖跨文章计数"
      }
    },
    {
      "type": "constrained_by",
      "to": "invariant-support-count"
    }
  ],
  "legacy_type": "falsified",
  "legacy_relations": {
    "refutes": [
      "claim-inverted-pyramid"
    ],
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
四簇 127 次调用、零失败批次。调用数 71→30（−57.7%），neurons −58.3%；但 c0 清单召回
11/13→6/13（红线是掉 2 条），支持数 ≥2 的清单事实 13→8。

**失败模式是结构性的**：核心文章数固定为 4，簇越大核心占比越低（c0/c3/c13 只有 25–29%，
c18 却有 67%）。所以**召回崩盘恰好发生在最需要省钱的大簇上**，而 c18 看起来安全只是因为
选材规则对它几乎没生效。一句话：省钱只在不贵的地方安全。
