---
{
  "id": "experiment-practice-sixty",
  "type": "experiment",
  "title": "60 题练习：共同有效材料上代码槽漏错 7/29，整句对照 3/29",
  "date": "2026-09-17",
  "status": "recorded",
  "tasks": ["治事实关系错", "演化组合架构"],
  "scope": "glm-4.7-flash，五个 dev 簇，60 道人工练习；共同有效 54 题；非盲单标注，非独立验证",
  "source": "eval/cluster-to-brief/arms/atomic-evidence/PRACTICE-RESULT.md",
  "conditions": ["Workers AI 是被测模块；参考标签与语义判断来自当前 Codex，无远程 judge"],
  "evidence_origin": "local_record",
  "relations": [{"type": "yields", "to": "lesson-practice-typed-anchors"}],
  "kind": "prototype_evaluation",
  "outcome": "failed",
  "inputs": "30 正常表述、30 人工错误变体、32 原错误片段、18 事件组；temperature 0/0.1 契约重试",
  "evaluation": "冻结原句参考标签，Codex 本地核对漏判与变化；程序按原整句放行记录逐错误保留，不冒充逐错误机制诊断",
  "result": "共同有效 54 题：整句漏错 3/29、代码槽 7/29；正常拒绝均 0/26；最终契约失败分别 2/60 与 5/60。模型槽第一批缺维度/假归因，第二批规划契约失败，停止扩大。无独立验证、组合或生产达标结论",
  "cost": "已记录 51 HTTP 响应，54649 input / 31877 output tokens、累计 876.61 秒；不含一条未返回 usage 的中断请求，实际美元计费未知",
  "record_completeness": "summary_only"
}
---

没有共同有效题由整句漏错变为代码槽正确拦截，新增四个漏判。零语义拒绝不等于正常题零损失，引用契约失败还会挡掉正常候选。详见原结果与 out/atomic-evidence/practice-v1/local-review.json。
