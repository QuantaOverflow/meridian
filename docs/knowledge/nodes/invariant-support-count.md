---
{
  "id": "invariant-support-count",
  "title": "「被几篇报道」是骨架与分层的骨干信号，所以每篇都得读到",
  "date": "2026-09-11",
  "status": "live",
  "source": "docs/adr/0004-brief-writer-v3.md",
  "invalidates_when": "改用别的重要性信号（如单篇内的显著性、编辑打分），不再靠跨文章支持数",
  "type": "goal",
  "tasks": [
    "降低报告层成本",
    "改报告层结构"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "historical_document",
  "relations": [],
  "legacy_type": "invariant",
  "legacy_relations": {},
  "kind": "constraint",
  "criteria": "「被几篇报道」是骨架与分层的骨干信号，所以每篇都得读到"
}
---
报告里每条事实带 `articles`（被几篇不同文章报道）。它决定两件事：**≥2 篇才算骨架事实**
（写作层唯一的「要点」来源），以及简报的**分层排序**（源数 × 篇数）。

后果：要数出这个数，就必须看过每一篇——这条不变量是后面一连串降本方案失败的共同原因。
任何「少读一些文章」的设计都会先撞到它。
