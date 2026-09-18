---
{
  "id": "falsified-bigger-extraction-batch",
  "title": "抽取批大小 20→60：省 41–47% neurons，但召回真掉（−17%~−25%，满覆盖对照）",
  "date": "2026-09-14",
  "status": "live",
  "source": "apps/backend/prototypes/cost-split/out/REPORT.md",
  "invalidates_when": "下游（去重、写作层）被确认能容忍更高遗漏率，且有独立的召回护栏",
  "type": "lesson",
  "tasks": [
    "降低报告层成本",
    "改抽取prompt"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [
    "清单召回不能掉",
    "骨架 = 被 ≥2 篇报道"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "based_on",
      "to": "measure-cost-input-output-split",
      "attributes": {
        "scope": "提出或解释结论的已有依据；不表示该方案已经直接测试"
      }
    }
  ],
  "legacy_type": "falsified",
  "legacy_relations": {
    "supports": [
      "method-two-fighting-readings"
    ],
    "measured_by": [
      "measure-cost-input-output-split"
    ]
  },
  "kind": "failure_or_literature_warning"
}
---
c18 20/30→15/30（−25%）、c0 12/13→10/13（−17%），**两簇都是满覆盖下测的**，不是批次失败造成的假象。

降本的机制不是「摊薄固定指令开销」（那条理论上限只有 ≈8.7 个百分点），而是**模型在大批量下
输出变少了**（completion_tok/句 降近一半）——它不是更精炼，是真的漏事实。拿覆盖率换成本，不是免费午餐。

**方法论**：静态的 token 占比推算只能当下限参考。涉及模型行为的杠杆必须实跑——这次实际效果
（41–47%）比理论上限（8.7pp）大了五倍，方向还正好是坏的那一面。
