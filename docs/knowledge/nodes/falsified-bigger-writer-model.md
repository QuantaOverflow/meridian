---
{
  "id": "falsified-bigger-writer-model",
  "title": "换更大的写作模型治不了关系错：只换错法，成本 5–11 倍",
  "date": "2026-09-12",
  "status": "live",
  "source": "docs/adr/0004-brief-writer-v3.md",
  "invalidates_when": "出现价格接近 glm-flash 的强模型，或关系错的判据本身被重新定义",
  "type": "lesson",
  "tasks": [
    "治事实关系错",
    "降低写作层成本"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [
    "写作材料 = report-v3",
    "一块一次调用"
  ],
  "evidence_origin": "historical_document",
  "relations": [],
  "legacy_type": "falsified",
  "legacy_relations": {},
  "kind": "failure_or_literature_warning"
}
---
盲审读数（每 10 句的关系错）：glm-4.7-flash **1.37**、llama-3.3-70b **1.29**（成本 5×）、
gpt-oss-120b **2.85**（成本 11×）。

结论：关系错是小模型融合多条事实时产生的，**便宜模型的写作与检测都已接近上限**；
要放心发布得靠发布前的强判官（离线）或人工把关，不是换写作模型。
