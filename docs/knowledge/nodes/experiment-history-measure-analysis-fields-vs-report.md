---
{
  "id": "experiment-history-measure-analysis-fields-vs-report",
  "type": "experiment",
  "title": "历史证据摘要：同一批文章被 LLM 读三遍；但拿文章分析的字段替代报告层抽取，覆盖掉一截且成本只打平",
  "date": "2026-09-15",
  "status": "recorded",
  "tasks": [
    "降低报告层成本",
    "改报告层结构"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "source": "生产库 articles.event_summary_points + M1-1789308830116 落盘报告",
  "conditions": [],
  "evidence_origin": "local_analysis",
  "relations": [
    {
      "type": "yields",
      "to": "measure-analysis-fields-vs-report"
    }
  ],
  "kind": "retrospective_analysis",
  "outcome": "observed",
  "inputs": "输入范围见原经验正文；准确运行清单未从历史节点恢复",
  "evaluation": "沿用原文中的读数与判据；不宣称独立复评",
  "result": "同一批文章被 LLM 读三遍；但拿文章分析的字段替代报告层抽取，覆盖掉一截且成本只打平",
  "cost": "未从证据中确定，不补写估算",
  "record_completeness": "summary_only"
}
---

同一批文章被 LLM 读三遍；但拿文章分析的字段替代报告层抽取，覆盖掉一截且成本只打平

这是迁移时建立的证据摘要，不是新增执行。原始结论正文仍在 measure-analysis-fields-vs-report；模型配置、prompt/code/data 版本和调用次数若未记载，均为未知。
