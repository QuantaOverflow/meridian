---
{
  "id": "method-goal-guided-evolution",
  "title": "固定目标与验收尺，小原型看信号，按职责融合并持续回归，让架构受约束地演化",
  "date": "2026-09-17",
  "status": "active",
  "source": "docs/engineering-notes/goal-guided-evolutionary-architecture.md",
  "invalidates_when": "无法建立可信反馈、关键决策不可逆或试验风险超出预算时，应先做更充分的事先设计与风险分析",
  "type": "mechanism",
  "tasks": [
    "演化组合架构",
    "设计验收门",
    "降低报告层成本",
    "治事实关系错"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "requires",
      "to": "method-quality-attribute-scenarios"
    },
    {
      "type": "requires",
      "to": "method-two-fighting-readings"
    }
  ],
  "legacy_type": "method",
  "legacy_relations": {
    "depends_on": [
      "method-two-fighting-readings"
    ]
  },
  "kind": "method",
  "input": "按重要性排序并冻结到当轮的质量属性场景、任务约束与历史证据",
  "output": "固定目标与验收尺，小原型看信号，按职责融合并持续回归，让架构受约束地演化",
  "limits": "无法建立可信反馈、关键决策不可逆或试验风险超出预算时，应先做更充分的事先设计与风险分析",
  "verification": "method"
}
---

有不确定性的开发先用轻量质量属性场景澄清相关人、刺激、环境、期望响应、直接度量和业务优先级；再固定当轮目标、约束和验收尺。具体架构在实现反馈中演化，不是无设计的反复打补丁。
每轮循环：澄清并排序场景 → 查前置知识 → 选一个缺口 → 写可检验假设 → 最小原型 → 看信号 → 蒸馏节点 → 按职责融合 → 回归。
Workers AI 只用于低成本开发迭代，看到方向性信号就停；语义 judge 由当前 Codex 会话读原文完成，不另调远程 judge。
每轮同时看覆盖、事实错、误杀与成本；被测 gate 的输出和机械 verifier 通过都不是独立事实验收。
知识图谱保存证据、失败机制与边界，不是自动融合算法；原型通过、组合通过和端到端达标必须分开。
依据来自 XP 演化设计、演化架构、集合式设计与 Twin Peaks；这些是方法支持，不是本项目成功证明。
