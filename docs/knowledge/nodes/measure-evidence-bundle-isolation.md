---
{
  "id": "measure-evidence-bundle-isolation",
  "title": "相同证据包隔离在八句探针有效，但扩展仍误杀和漏判，不能视为充分安全边界",
  "date": "2026-09-17",
  "status": "live",
  "source": "scripts/eval/cluster-to-brief/arms/atomic-evidence/GOAL.md",
  "invalidates_when": "换模型或证据门表示后，整批判定在同一组关系错对照上达到相同召回且没有跨项借证据",
  "type": "lesson",
  "tasks": [
    "治事实关系错",
    "设计验收门"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "based_on",
      "to": "measure-attribution-not-faithfulness"
    },
    {
      "type": "motivates",
      "to": "attempt-specialist-risk"
    },
    {
      "type": "motivates",
      "to": "attempt-plan-verify-backfill"
    }
  ],
  "legacy_type": "measurement",
  "legacy_relations": {
    "supports": [
      "method-two-fighting-readings"
    ],
    "depends_on": [
      "measure-attribution-not-faithfulness"
    ]
  },
  "kind": "observation"
}
---

`c36` 的 direct-raw 成稿有 4 个已知硬错。用 4 个正确句作对照，把候选先做纯句法原子化、
再让 `glm-4.7-flash` 对原句证据判完整支持：

- 21 个原子整批判：会漏掉已知的 3500 万桶、管道关闭/伊拉克来源、错误归属；
- 两个父句一批：仍把另一个原子的 source index 借来支持当前原子；
- 一个父句一批：同一父句内仍会跨原子借证据；
- **按完全相同的证据坐标分组**：4 个坏句全部拦到至少一个坏原子，4 个正确对照零误杀；
  9 个最小对照（错误归属、缺失实体、动作夸大、虚构来源地及其正例）全过。

通过的 8 句探针用了 12 次证据包调用，合计 9,290 input tokens、2,197 output tokens、
100.7 秒。因此不能先把 156 个候选全核一遍；架构顺序应改成**粗覆盖规划 → 只核入选候选 →
失败时在同事件槽内补位**。

这条不是「小 batch 总是更好」。不变量是：判官看到的证据集合必须与当前所有被判原子完全一致，
不能让某原子接触到它没有声明的旁证，否则便宜模型会把相关证据误当成该断言的完整证据。

后续 30 句扩展失败：26 个正常对照中 4 句被拒；聚焦 v5 仍拒绝 2/4 个正常对照，且漏判错误归因和时序。
早期结论仅限八句探针。原子引用不应由看不到证据的模型猜测，而应由代码继承父候选完整证据包。
证据隔离不足以保证语义可靠性，仍需验证逐维对齐与风险专门核验；输出结构有效不等于事实正确。
