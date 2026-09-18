---
{
  "id": "experiment-history-falsified-retrieval-gapfill-loop",
  "type": "experiment",
  "title": "历史证据摘要：写作层的「找漏 → 检索 → 重写」补漏 loop：覆盖只 +4–6 点，去掉后反而更高",
  "date": "2026-09-12",
  "status": "recorded",
  "tasks": [
    "提高写作层覆盖",
    "降低写作层成本"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "source": "docs/adr/0004-brief-writer-v3.md",
  "conditions": [],
  "evidence_origin": "historical_document",
  "relations": [
    {
      "type": "yields",
      "to": "falsified-retrieval-gapfill-loop"
    }
  ],
  "kind": "retrospective_analysis",
  "outcome": "observed",
  "inputs": "输入范围见原经验正文；准确运行清单未从历史节点恢复",
  "evaluation": "沿用原文中的读数与判据；不宣称独立复评",
  "result": "写作层的「找漏 → 检索 → 重写」补漏 loop：覆盖只 +4–6 点，去掉后反而更高",
  "cost": "未从证据中确定，不补写估算",
  "record_completeness": "summary_only"
}
---

写作层的「找漏 → 检索 → 重写」补漏 loop：覆盖只 +4–6 点，去掉后反而更高

这是迁移时建立的证据摘要，不是新增执行。原始结论正文仍在 falsified-retrieval-gapfill-loop；模型配置、prompt/code/data 版本和调用次数若未记载，均为未知。
