---
{
  "id": "lesson-grounding-is-citation-quality",
  "type": "lesson",
  "title": "逐句接地的真机制是「引用标得准」，不是「写得对」——旧的硬错归因作废",
  "date": "2026-09-19",
  "status": "recorded",
  "tasks": ["演化组合架构", "设计验收门"],
  "scope": "cluster-to-brief 的 direct-raw-grounded 臂；证据来自新 scorer 上 dev 五簇盲判与 c7/c37 的反向检验。无人工金标",
  "source": "docs/knowledge/nodes/experiment-scorer-retrieval-evidence-dev.md 与 experiment-frontier-dev5-blind.md",
  "conditions": [
    "新 scorer 的事实证据由脚本全簇检索，与成稿引了谁无关；引用质量单列为 citedSentenceSuffices",
    "旧读数出自「证据=成稿自引的单句」那把 scorer，与本条不可比"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "supersedes", "to": "lesson-scorer-steers-search", "attributes": {"scope": "只取代其中「逐句接地硬错 5→1」这条归因与 (a)(b) 两项缺陷的现状描述；(c) 已补上指标，(d) 仍缺"}},
    {"type": "cautions", "to": "mechanism-raw-candidate-discovery", "attributes": {"scope": "凡是靠丢候选拿到的硬错下降，在新 scorer 上要重新归因才能当 crossover 供体"}}
  ],
  "kind": "mechanism_attribution",
  "invalidates_when": "在跨日期、未接触的簇上重测，引用不足率的优势不再是量级差异"
}
---

**旧账**：逐句接地（生成候选句后逐句拿它声称的出处去核，核不住整句丢掉）
在旧 scorer 上把硬错从 5 压到 1，这个数字被写进了归因。

**为什么是假的**：旧判定包只给判官「成稿引的那一句」，一句话有多个成分时缺的那半常在紧邻句里，
判官看不到就记成 hard。而这个过滤器问的正是同一个问题——被引那句撑得住吗，撑不住就删。
**过滤器和门读的是同一份证据、用的是同一个判据，等于同一个测试跑了两遍，一遍当过滤器一遍当门。**
所以门当然全绿。它优化的是 scorer 的缺陷，不是质量。

**新账**（dev 五簇，盲判）：

| 轴 | grounded | direct-raw |
|---|---|---|
| 引用不足率 | **14.8%** | 27.6% |
| 核心层覆盖 | 76.2% | 95.2% |
| 硬错 | 2 | 1 |

硬错优势归零；**引用质量优势是真的，近 2 倍，属于能站住的量级差异**。覆盖代价也是真的
（c37 核心层 0/3 判不合格，写了缅甸没写柬泰）。

**过滤器的形状**：召回 100%、精度 6% —— 为清掉 5 条硬错毁了 66 条判官判为正确的句子。
高召回低精度的过滤器，在候选池厚的簇上代价被稀释，在候选池薄的簇上直接把正题削光
（c37 纯净候选丢 88%、杂质候选只丢 49%）。

### 对 crossover 的意义

CONTEXT.md 的判据是「供体的那个优势必须已经被归因过」。
**归因换了对象但仍然成立**：可以当供体，但接过去的是「引用标得准」，**不是**「写得对」。
接的时候要连 limits 一起接——它会砍掉大量候选，在候选池薄的簇上要有兜底。
