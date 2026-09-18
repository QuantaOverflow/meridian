---
{
  "id": "falsified-sentence-semantic-folding",
  "title": "句子层语义折叠（抽取前先把跨文章近重复并成堆）：冗余不够，且会并错方向",
  "date": "2026-09-14",
  "status": "live",
  "source": "apps/backend/prototypes/brief-v3-prod/out/redundancy-probe.md",
  "invalidates_when": "语料变成以通稿转载为主，或有了能可靠判「同一事实」的廉价判据（非余弦）",
  "type": "lesson",
  "tasks": [
    "降低报告层成本",
    "改报告层结构"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [
    "每篇都要读到才能数支持数",
    "数字冲突要能被看见"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "based_on",
      "to": "measure-cross-article-redundancy",
      "attributes": {
        "scope": "提出或解释结论的已有依据；不表示该方案已经直接测试"
      }
    },
    {
      "type": "constrained_by",
      "to": "invariant-support-count"
    }
  ],
  "legacy_type": "falsified",
  "legacy_relations": {
    "measured_by": [
      "measure-cross-article-redundancy"
    ],
    "depends_on": [
      "invariant-support-count"
    ]
  },
  "kind": "failure_or_literature_warning"
}
---
设想是把「折叠冗余」从 LLM 之后挪到之前：先归堆、每堆只抽一次，支持数由堆的文章成员直接得到。

三条否决理由：冗余率只有 23.5% 且看新闻类型；即便覆盖率过关，抽取调用也只少 17–24%
（大多是 2 篇合 1 堆）；降阈值就并错方向。**还有一个新结构独有的风险**：原始报道之间的数字冲突
（10 vs 11 名患者）会被折叠抹平，而且只送一条代表句去抽取，另一个数字连被模型看到的机会都没有。
