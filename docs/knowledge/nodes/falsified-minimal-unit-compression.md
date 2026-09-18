---
{
  "id": "falsified-minimal-unit-compression",
  "title": "把最小单元当降本手段：产出比现行自由句还长（52–56% vs 40–50%），但召回更好",
  "date": "2026-09-14",
  "status": "live",
  "source": "apps/backend/prototypes/srl-compress/out/",
  "invalidates_when": "目标从「省 token」换成「提质量/可核对性」——那时这条结论不适用",
  "type": "lesson",
  "tasks": [
    "降低报告层成本",
    "改报告层结构"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [
    "引用要可解析",
    "清单召回不能掉"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "cautions",
      "to": "claim-minimal-unit-representation",
      "attributes": {
        "scope": "把最小单元当降本手段：产出比现行自由句还长（52–56% vs 40–50%），但召回更好；成立条件见正文，失效条件：目标从「省 token」换成「提质量/可核对性」——那时这条结论不适用"
      }
    }
  ],
  "legacy_type": "falsified",
  "legacy_relations": {
    "refutes": [
      "claim-minimal-unit-representation"
    ],
    "supports": [
      "method-two-fighting-readings"
    ]
  },
  "kind": "failure_or_literature_warning"
}
---
codex 原型，glm-4.7-flash，23 次调用约 $0.01。四条判据：**压缩不过**（c0 56.3%、c18 52.1%
占原文，比现行自由句方案 40–50% 还长）；**可回溯过**（257 条出处全部解析得到）；
**召回 c18 24/30 反而好于生产现行的 20–22**；归属分离结构上做到了但仍有 8–17 条 fact 混着 said/told。

**归因不是模型能力**——这次没崩（对比 falsified-five-slot-srl）。是目标不匹配：拆成最小单元后
一句原文变两三条，每条都要重写主语、各自挂出处，**总字数不降反升**。

**一个测量坑**：原型自报 `contentRatio 5.2%` 是假的——分母用了整簇字符数、分子是单篇产出，
按本篇算是 32%、全簇并集算是 52%。自动算出来的比率一定要核对分子分母的口径。

> **2026-09-15：失效条件已被触发。** 目标改成「提质量 / 减少转述层数」后，本条不再适用——
> 这里的 c18 召回 24/30（优于生产现行 20–22）反过来成了正面证据。
> 见 claim-anchor-not-rewrite；别拿本节点去否那条主张。
