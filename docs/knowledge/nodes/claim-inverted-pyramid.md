---
{
  "id": "claim-inverted-pyramid",
  "title": "新闻是倒金字塔，主干事实集中在前几句，长尾多是背景",
  "date": "2026-09-14",
  "status": "live",
  "source": "docs/engineering-notes/fact-compression-representations.md",
  "invalidates_when": "语料从通讯社硬新闻换成深度报道/专栏为主",
  "type": "lesson",
  "tasks": [
    "降低报告层成本"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [],
  "legacy_type": "claim",
  "legacy_relations": {},
  "kind": "hypothesis_or_research_finding"
}
---
推论是：少数核心文章读全文、其余只读导语，事实几乎不丢，于是能少喂很多 token。

**部分成立但不够用**：实测三个大簇里 80%+ 的丢失事实确实来自第 6 句之后（中位句号 15–17）。
但「主干在前面」说的是**共有事实**；**独家事实散在长尾**（某部长的单独表态、8 月失业 4.1 万、
关税生效时间），而独家事实恰恰没有第二篇能兜底。见 falsified-input-position-truncation。
