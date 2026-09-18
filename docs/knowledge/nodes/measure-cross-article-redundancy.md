---
{
  "id": "measure-cross-article-redundancy",
  "title": "跨文章句子重复率只有 23.5%（加权），且高度依赖新闻类型",
  "date": "2026-09-14",
  "status": "live",
  "source": "apps/backend/prototypes/brief-v3-prod/out/redundancy-probe.md",
  "invalidates_when": "语料构成变化（通稿转载占比上升），或换更强的句子编码器",
  "type": "lesson",
  "tasks": [
    "降低报告层成本",
    "改报告层结构"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [],
  "legacy_type": "measurement",
  "legacy_relations": {},
  "kind": "observation"
}
---
bge-m3、余弦 ≥0.90 下的跨文章重复堆覆盖率：c0 39.0%、c3 34.3%、c13 8.0%、**c18 0.0%**，
句数加权 23.5%。逐字重复率 14.9%/11.2%/5.0%/0%。

两条附带读数：**覆盖率 ≠ 省钱率**（c0 覆盖 39% 但抽取调用只少 17.6%，因为大多是「2 篇合 1 堆」）；
阈值降到 0.85 就会把「加拿大报复关税」和「美国加征关税」并进同一堆（方向对调）。
通稿型硬新闻冗余高、深度报道与政策解读几乎没有——而我们每天 25 条什么类型都有。
