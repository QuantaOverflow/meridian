---
{
  "id": "measure-analysis-fields-vs-report",
  "title": "同一批文章被 LLM 读三遍；但拿文章分析的字段替代报告层抽取，覆盖掉一截且成本只打平",
  "date": "2026-09-15",
  "status": "live",
  "source": "生产库 articles.event_summary_points + M1-1789308830116 落盘报告",
  "invalidates_when": "文章分析的 prompt 改成产出事实级内容（带句级出处），或筛选顺序改成先聚类后分析",
  "type": "lesson",
  "tasks": [
    "降低报告层成本",
    "改报告层结构"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_analysis",
  "relations": [],
  "legacy_type": "measurement",
  "legacy_relations": {},
  "kind": "observation"
}
---
**同一批文章，LLM 读了三遍**，三条流水线互不复用：

| 遍 | 谁 | 产出 | 谁消费 |
|---|---|---|---|
| 1 | 文章分析（全量 500–770 篇/天） | `event_summary_points` 等结构化字段 | 拼成文本喂 embedding，供聚类 |
| 2 | 报告层 extract（入选 ~150 篇/天） | 带出处的事实 | 写作层要点 |
| 3 | 报告层 voices（入选 25 簇/天） | 当事方、分歧 | 写作层立场材料 |

第一遍的产出除了拼成一个字符串喂 embedding，**再没人用过**。

**能不能直接拿摘要点替代抽取——测了，不行**（金标同口径）：

| | c0（金标 13） | c18（金标 30） |
|---|---|---|
| 摘要点（107 条 / 36 条） | 9/13 | 16/30 |
| 报告层全部事实（78 / 27 条） | **13/13** | **20/30** |

摘要点**条数比报告层事实还多**却覆盖更低。漏的全是专名、机构、金额：`Greer`、`Davos`、
`European Parliament`、`Mosseri`、`Dutch court`、`$18bn settlement`、`Greens`、`New Zealand`。
根因是两个 prompt 的目标不同——分析写的是给 embedding 用的**概括性主题句**，报告层写的是
给写作层用的**事实台账**，概括天然丢专名。

**把抽取搬进分析层也不划算，原因是基数**：分析对全量 500–770 篇跑，报告层只对入选 ~150 篇跑，
比例 3.7:1。每篇多输出约 280 token 的详细事实要对 550 篇付（≈5,700 neurons/天），
而省下的 extract + voices 只在 150 篇/25 簇上（≈5,900 neurons/天）——**大致打平，且对每天篇数敏感**
（按 770 篇算就变净亏）。现行架构「把贵的抽取放在筛选之后」是对的。

**想倒过来（先聚类后分析）走不通**：embedding 的输入是 `generateSearchText`，而它拼的正是分析产出的字段，
所以分析必须全量先跑。用户口径的理由更根本——**不能预先假设标题和摘要能筛出该要的文章，
分析本身就是召回机制**。

顺带记一条盲区：`generateSearchText` 只有一句「从文章分析数据中提取关键信息」的注释，没有任何理由记录，
git 历史里只经历过目录重构；`eval/clustering/` 有金标、打分器、rubric，
但**从没测过 embedding 的输入文本**，测的全是聚类器与阈值。
