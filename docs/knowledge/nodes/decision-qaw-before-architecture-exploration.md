---
{
  "id": "decision-qaw-before-architecture-exploration",
  "type": "decision",
  "title": "不确定性开发先做轻量质量属性场景澄清与优先级排序",
  "date": "2026-09-21",
  "status": "accepted",
  "tasks": ["演化组合架构", "设计验收门", "澄清需求"],
  "scope": "后续有不确定性的架构探索、原型设计、方案选择和重要验收尺调整；不扩张到普通机械修改",
  "source": "docs/knowledge/nodes/method-quality-attribute-scenarios.md；用户于 2026-09-21 明确要求后续开发方法论参考 QAW，先澄清需求和重要性",
  "conditions": [
    "采用轻量场景模板，不把完整工作坊仪式设成每轮前置负担",
    "优先级与响应度量在设计候选前明确，当轮实验开始后冻结",
    "QAW 结果是 ADD、原型与验收设计的输入，不替代它们"
  ],
  "evidence_origin": "user_decision_and_external_literature_not_reproduced",
  "relations": [
    {
      "type": "selects",
      "to": "method-quality-attribute-scenarios",
      "attributes": {
        "action": "采用为有不确定性开发的轻量前置方法，先澄清并排序质量属性场景"
      }
    }
  ],
  "action": "后续开始有不确定性的开发时，先用轻量 QAW 场景明确需求、业务重要性和可测响应，再选择 tactics、架构和最小实验；机械小改无需执行",
  "invalidates_when": "连续实践表明该步骤没有减少歧义、返工或错误实验优先级，且维护成本持续高于收益时，重新评估其形式与适用范围"
}
---

这项决定增加的是需求澄清与排序步骤，不改变“当轮验收尺冻结”的原则。Twin Peaks 允许新证据推动下一版需求细化，但不得在看完某个候选结果后只为该候选改尺。

实际使用时先细化最高优先级的少数场景即可；输出应能直接成为 ADD 的架构驱动、实验 fixture 的来源和 fitness function 的响应度量。
