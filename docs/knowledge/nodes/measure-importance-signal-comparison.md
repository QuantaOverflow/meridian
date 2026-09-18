---
{
  "id": "measure-importance-signal-comparison",
  "title": "拿金标同预算对照，票数仍是最好的单一重要性信号；位置/标题/数字全都更差",
  "date": "2026-09-15",
  "status": "live",
  "source": "apps/backend/prototypes/report-3step/fixtures/fact-checklists.json + M1-1789308830116 落盘报告",
  "invalidates_when": "换重要性的定义（不再是「进简报该写的事实」），或金标换成全覆盖标注",
  "type": "lesson",
  "tasks": [
    "改报告层结构",
    "设计验收门"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "constrained_by",
      "to": "invariant-support-count"
    }
  ],
  "legacy_type": "measurement",
  "legacy_relations": {
    "supports": [
      "method-two-fighting-readings"
    ],
    "depends_on": [
      "invariant-support-count"
    ]
  },
  "kind": "observation"
}
---
问题：有没有比「被几篇报道」更好的重要性信号。方法：拿人工金标（c0 13 条、c18 30 条，
`keys` 任一命中即算，与 accept.ts 同口径）当靶子，**同样挑 K 条**，看谁捞回的金标多。

c0，取前 22 条（= skeleton 条数）：

| 信号 | 捞回金标 |
|---|---:|
| 票数（现行） | **10** |
| 票数×标题 | 10 |
| 票数+位置 | 10 |
| 标题重叠 | 8 |
| 专名个数 | 8 |
| 位置（越早越高） | 7 |
| 数字个数 | 5 |

预算收紧到 10 条时差距拉大：票数 8、位置 3、标题 4；组合信号（票数×标题）9，是唯一有改进迹象的地方，
但一个簇一条之差，在噪声内。

**c18 是反例，值得单独记**：该簇只有 6 篇文章，票数天然稀疏（skeleton 仅 3 条）。取前 10 条时
**数字个数 11 反而好过票数 6**。所以票数信号在小簇上失效——没有足够的「投票人」。

**一个方法坑（这轮自己先踩了）**：位置信号初看分离很强（要点首次出现句号中位 7 vs 单票 24），
但那是取「所有出处里最靠前的那句」——要点天生有 ≥2 个出处，**取 min 本身就偏向出处多的**。
改成每个出处各算一次再平均后：c0 12 vs 24（还在）、c3 15 vs 17（几乎没了）、
**c13 14 vs 12（反转，要点反而出现得更晚）**。机制：一条被多篇报道的事实，在某篇是导语、在另一篇是末尾回顾。

**结论**：别换信号，要改就改权重。生产库近 14 天的读数显示各源文章落进简报的比例从 46.4% 到 0.0%
（source_id=1 的 381 篇一篇没进过），而现在所有源的票等价——**按来源权威度加权是唯一有数据支撑的改进方向**，
但收益量级未测。
