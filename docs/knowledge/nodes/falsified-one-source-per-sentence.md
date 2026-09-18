---
{
  "id": "falsified-one-source-per-sentence",
  "title": "限制「每句正文只依据 1–2 条要点」来防关系错：头条缩到 530 字符、覆盖跌破门",
  "date": "2026-09-12",
  "status": "live",
  "source": "docs/adr/0004-brief-writer-v3.md",
  "invalidates_when": "长度与覆盖的门放宽，或找到「限融合但不缩水」的写法（方向本身未被证伪）",
  "type": "lesson",
  "tasks": [
    "治事实关系错"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [
    "头条目标 1,200–2,000 字符",
    "骨架覆盖有下限"
  ],
  "evidence_origin": "historical_document",
  "relations": [],
  "legacy_type": "falsified",
  "legacy_relations": {},
  "kind": "failure_or_literature_warning"
}
---
关系错的根因是模型融合多条事实时接错，所以试过强制每句最多用 1–2 条要点。
结果头条**缩到 530 字符**、骨架覆盖跌破验收门——按这个做法不可用。

**注意边界**：被证伪的是这个实现，不是「限融合能降关系错」这个方向——长度与覆盖的问题没解决而已。
代码以 `variant: 'one-source'` 保留，默认不走。
