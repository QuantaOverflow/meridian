---
{
  "id": "decision-exact-premerge",
  "title": "逐字相同的事实先合并（preMergeIdentical）——这是修 bug，不是降本",
  "date": "2026-09-13",
  "status": "live",
  "source": "services/meridian-ai-worker/src/utils/report-v3.ts",
  "invalidates_when": "抽取改成每条事实只产出一次（不再跨批重复），这一步就没用了",
  "type": "decision",
  "tasks": [
    "降低报告层成本",
    "改去重"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_analysis",
  "relations": [
    {
      "type": "constrained_by",
      "to": "invariant-support-count"
    }
  ],
  "legacy_type": "decision",
  "legacy_relations": {
    "depends_on": [
      "invariant-support-count"
    ]
  },
  "action": "历史决定或进度记录；实际状态以正文及 source 为准，不能由 live 推断已部署"
}
---
c3 实测到两条逐字相同、分属两篇文章的事实各自成单元，于是本该「被 ≥2 篇报道」的骨架事实被算漏。
预合并后四簇 identical-facts 全为 0。

**成本没省**（2,398 vs 2,340 neurons，在跑间波动内）。跑间波动本身很大：同一批输入三次跑，
原始事实 118/118/123、177/166/180——**小于 5% 的成本差别在这个噪声水平下没有意义**。
