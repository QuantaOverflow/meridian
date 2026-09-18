---
{
  "id": "measure-auto-risk-question-drift",
  "title": "自由风险问题规划在四句开发样本中重复整句且把 after 改成 cause，不能直接接专门核验",
  "date": "2026-09-17",
  "status": "live",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/AUTO-RISK-RESULT.md",
  "invalidates_when": "规划表示改变后能生成独立且完整的风险问题，并在正常时序与归因对照上不引入新前提",
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
      "type": "based_on",
      "to": "measure-specialist-risk-gate"
    },
    {
      "type": "requires",
      "to": "method-goal-guided-evolution"
    },
    {
      "type": "motivates",
      "to": "attempt-constrained-risk-slots"
    }
  ],
  "legacy_type": "measurement",
  "legacy_relations": {
    "depends_on": [
      "measure-specialist-risk-gate",
      "method-goal-guided-evolution"
    ]
  },
  "kind": "observation"
}
---

glm 只看候选自动生成 1–3 个问题；四句都生成三个，复合归因未形成独立身份检查，时序问题出现同义重复。
正确 after 候选被额外改问 cause，引入候选未断言的因果；精确 claimSpan 和结构校验不能防止问题语义漂移。
Codex 本地检查规划质量后停止，未运行下游 specialist，因此没有新的 gate 准确率结论。
一次有效调用仅 336 input / 526 output tokens；小成本已看到信号，不重跑扩大样本。
下一假设是受约束风险槽加确定性问题模板，仍需测试缺省维度与归因作用域，不能默认已解决。
