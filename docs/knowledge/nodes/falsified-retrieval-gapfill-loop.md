---
{
  "id": "falsified-retrieval-gapfill-loop",
  "title": "写作层的「找漏 → 检索 → 重写」补漏 loop：覆盖只 +4–6 点，去掉后反而更高",
  "date": "2026-09-12",
  "status": "live",
  "source": "docs/adr/0004-brief-writer-v3.md",
  "invalidates_when": "检索通道换成能定位「该说而没说」的东西（现在是按与成稿相似度检索，天然捞回已写过的）",
  "type": "lesson",
  "tasks": [
    "提高写作层覆盖",
    "降低写作层成本"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [
    "材料 = report-v3 的要点与原话",
    "一块一次主调用"
  ],
  "evidence_origin": "historical_document",
  "relations": [
    {
      "type": "constrained_by",
      "to": "invariant-citation-resolvable"
    }
  ],
  "legacy_type": "falsified",
  "legacy_relations": {
    "depends_on": [
      "invariant-citation-resolvable"
    ]
  },
  "kind": "failure_or_literature_warning"
}
---
Goal 1 的做法：写完自检找漏 → 检索补材料 → 重写。实测每块多 **4–6 次调用**，覆盖只涨 4–6 点，
而且模型把新材料**贴在文末**、补的是边角事实。Goal 2 去掉整个 loop 后，覆盖 87%→89%（头条）**反而更高**。

根因：按「与成稿相似」检索，捞回来的都是已经写过的那些；真正漏掉的东西不相似，检索不到。
