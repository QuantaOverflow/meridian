---
{
  "id": "method-two-fighting-readings",
  "title": "验收必须留一条会跟主读数打架的读数，否则会被单边指标骗过去",
  "date": "2026-09-14",
  "status": "active",
  "source": "apps/backend/prototypes/brief-v3-prod/out/input-selection-spike.md",
  "invalidates_when": "永不失效（这是方法，不是结论）",
  "type": "mechanism",
  "tasks": [
    "降低报告层成本",
    "设计验收门"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "justified_by",
      "to": "falsified-bigger-extraction-batch"
    },
    {
      "type": "justified_by",
      "to": "falsified-dedup-candidate-tightening"
    },
    {
      "type": "justified_by",
      "to": "falsified-endtoend-longcontext-mds"
    },
    {
      "type": "justified_by",
      "to": "falsified-input-position-truncation"
    },
    {
      "type": "justified_by",
      "to": "falsified-minimal-unit-compression"
    },
    {
      "type": "justified_by",
      "to": "measure-evidence-bundle-isolation"
    },
    {
      "type": "justified_by",
      "to": "measure-importance-signal-comparison"
    },
    {
      "type": "justified_by",
      "to": "measure-pipeline-cascade-loss"
    }
  ],
  "legacy_type": "method",
  "legacy_relations": {},
  "kind": "method",
  "input": "任务目标、约束与历史证据",
  "output": "验收必须留一条会跟主读数打架的读数，否则会被单边指标骗过去",
  "limits": "永不失效（这是方法，不是结论）",
  "verification": "method"
}
---
今年被同一个坑咬了两次，方向相反：

1. **已知事实召回看不出漏合并**。收紧去重候选那轮，召回一条没掉（c0 12/13、c18 22/30），
   但骨架事实掉了 14%——召回只问「这条事实在不在」，不问「跨文章有没有并起来」。
   打架的那条读数是**骨架数**。
2. **词面匹配判「同一件事」假阴性极高**。位置截断那轮，文本匹配说 c18 丢了 14 条，
   用「这句话到底有没有被喂给模型」这种不依赖匹配的结构性检查复核，只有 2 条是真丢，**差 7 倍**。
   打架的那条读数是**结构性丢失**。

规矩：任何新的降本/选材实验，主读数之外必须配一条**不依赖同一套判定逻辑**的对照读数。
