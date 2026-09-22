---
{
  "id": "attempt-practice-risk-slots",
  "type": "attempt",
  "title": "扩展练习上比较完整支持核验、模型槽与显式词代码槽",
  "date": "2026-09-17",
  "status": "tested",
  "tasks": ["治事实关系错", "演化组合架构"],
  "scope": "五个 dev 簇的 60 道人工练习；模型槽仅第一批四题有下游调用；未使用 heldout",
  "source": "eval/cluster-to-brief/arms/atomic-evidence/PRACTICE-GOAL.md",
  "conditions": ["固定原句证据；仅练习、非盲单 Codex 标签"],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "addresses", "to": "goal-cluster-to-brief"},
    {"type": "varies_from", "to": "attempt-constrained-risk-slots", "attributes": {"changed": "扩大材料到五个 dev 簇；另测显式词代码选槽与整句兜底", "reason": "小样本反复调优不能证明风险规划和核验泛化"}},
    {"type": "evaluated_by", "to": "experiment-practice-sixty"}
  ],
  "hypothesis": "固定类型与代码问题模板可减少自由规划漂移，代码显式词进一步避免模型类别漂移",
  "changes": "模型枚举槽与代码显式词选槽分别实现；整句支持作为通用对照",
  "reason": "自由问题规划出现重复与 after→cause；需扩大材料比较实际得失",
  "next_unknown": "绑定角色与作用域的关系表示能否改善，而不制造误杀；该表示未实现",
  "verification": "development_only_failed_signal"
}
---

代码槽没有净收益，暂缓集成。完整结果与代码路径见 source 及 PRACTICE-RESULT.md；不证明所有风险槽设计无效。
