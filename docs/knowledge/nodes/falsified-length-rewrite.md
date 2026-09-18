---
{
  "id": "falsified-length-rewrite",
  "title": "让模型「压到 X 字符」重写：实测多次原样返回",
  "date": "2026-09-12",
  "status": "live",
  "source": "docs/adr/0004-brief-writer-v3.md",
  "invalidates_when": "换到能稳定遵守长度指令的模型档次",
  "type": "lesson",
  "tasks": [
    "控制成稿长度"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [
    "写作模型 = glm-4.7-flash 档"
  ],
  "evidence_origin": "historical_document",
  "relations": [],
  "legacy_type": "falsified",
  "legacy_relations": {},
  "kind": "failure_or_literature_warning"
}
---
Goal 1 用「把这段压到 X 字符」做长度控制，实测**多次原样返回**（模型确认了指令但不改），
白烧一次调用。

现行做法：长度目标写进 prompt（头条 1,200–2,000、要闻 500–900、简讯一句），
**只在超硬上限时由代码删尾句**（2,400 / 1,100 / 200）。代码删句不会引入新内容，也不花调用。
