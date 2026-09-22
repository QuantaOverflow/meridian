---
{
  "id": "measure-specialist-risk-gate",
  "title": "八个风险样本上，人工单问题核验零误杀；自由全维度对齐误杀两个正常事实，自动问题规划尚未验证",
  "date": "2026-09-17",
  "status": "live",
  "source": "eval/cluster-to-brief/arms/atomic-evidence/RISK-RESULT.md",
  "invalidates_when": "自动问题规划遗漏必要风险或引入错误前提，或未见样本上专门核验再次漏判和误杀",
  "type": "lesson",
  "tasks": [
    "治事实关系错",
    "设计验收门",
    "演化组合架构"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "requires",
      "to": "method-goal-guided-evolution"
    },
    {
      "type": "requires",
      "to": "method-two-fighting-readings"
    },
    {
      "type": "motivates",
      "to": "attempt-auto-risk-question"
    }
  ],
  "legacy_type": "measurement",
  "legacy_relations": {
    "depends_on": [
      "method-goal-guided-evolution",
      "method-two-fighting-readings"
    ]
  },
  "kind": "observation"
}
---

同样八个 c36 风险样本，glm 自由全维度证据对齐误杀 2/4 个正常事实，因生成不存在的归因和因果检查。
人工预先给单一风险问题的 specialist 与 Codex 逐条原文判定八例一致：漏判 0/4、误杀 0/4。
信号支持窄任务与原文证据锚点，不证明自动核验完整可靠；人工问题已经给了风险位置，自动规划尚未实现。
五次 HTTP 模型调用共 3,282 input / 4,542 output tokens；两次引用省略号格式失败经严格子串清洗恢复，原始返回保留。
下一轮先检验自动问题规划，再融合；纯时序对照应去掉 shutdown 这个动作增强混杂，不直接扩到全候选池。

后续四句自动规划已出现重复问题与 after→cause 漂移，见 `measure-auto-risk-question-drift`；本节点的人工单问题信号不代表自动链路成功。
