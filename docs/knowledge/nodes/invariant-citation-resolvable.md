---
{
  "id": "invariant-citation-resolvable",
  "title": "每条事实必须能指回「哪篇文章第几句」，报告要留全部原句",
  "date": "2026-09-12",
  "status": "live",
  "source": "docs/adr/0004-brief-writer-v3.md",
  "invalidates_when": "写作层不再做接地、检查器也不再逐句对齐（那时出处只剩审计用途）",
  "type": "goal",
  "tasks": [
    "改报告层结构",
    "降低报告层成本"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "historical_document",
  "relations": [],
  "legacy_type": "invariant",
  "legacy_relations": {},
  "kind": "constraint",
  "criteria": "每条事实必须能指回「哪篇文章第几句」，报告要留全部原句"
}
---
下游有三处直接吃这个字段：写作层的**接地守卫**（名字/数字不在材料里就删句）、**代码检查器**
（逐句对齐到事实、只在其出处窗口里找证据）、以及**引语逐字校验**。

后果：任何「压缩表示」的方案都不能把原句丢掉——报告里 `sentences` 全量留存是零成本的（不过 LLM），
真正受约束的是**事实必须携带可解析的 `sources`**。实测这条不难守：codex 原型 257 条出处 0 条失效。
