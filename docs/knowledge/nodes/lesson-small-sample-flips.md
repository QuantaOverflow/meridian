---
{
  "id": "lesson-small-sample-flips",
  "type": "lesson",
  "title": "三个簇上看到的机制差异，补到五个簇就消失了——n=5 只能分辨量级差异",
  "date": "2026-09-19",
  "status": "superseded",
  "tasks": ["演化组合架构", "设计验收门"],
  "scope": "cluster-to-brief 的 dev 五簇；七簇全部取自同一次生产运行，不是独立抽样",
  "source": "docs/knowledge/nodes/experiment-frontier-dev5-blind.md",
  "conditions": [
    "对照是同一把 scorer、同一轮、盲判、同一判官模型 —— 翻转不能归因于尺或跑间波动"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "cautions", "to": "mechanism-dominant-storyline-filter", "attributes": {"scope": "「主线筛选压制乱安来源」这条在三簇上是 3:1，五簇上是 4:3"}}
  ],
  "kind": "diagnostic_observation",
  "invalidates_when": "dataset 扩到 12 个以上跨日期簇之后重测"
}
---

**只跑 c7/c37/c43 时**，`direct-raw-routed` 硬错 3、`direct-raw-routed-storyline` 硬错 1，
据此写下「主线筛选这一步在压制乱安来源」。**补上 c1/c36 后变成 4 和 3**，差距从 3 倍缩到 1.3 倍。

而且 routed-storyline 自己在 c36 上出了 2 条硬错，两条都是消息源剥离（把伊朗单方面的说法
写成既定陈述）——也就是说它在大簇上犯的正是当初认为它能压住的那类错。

### 能站住与站不住的分界

| 读数 | 差距 | 能不能当证据 |
|---|---|---|
| grounded 引用不足 14.8% vs direct-raw 27.6% | 近 2 倍 | 能 |
| structure-router 覆盖 44% vs direct-raw 95% | 2 倍 | 能 |
| direct-raw 覆盖 95.2% vs routed-storyline 88.9% | 6 个百分点 | **不能** |
| routed 硬错 4 vs routed-storyline 3 | 1 条 | **不能** |

n=5 的配对符号检验，只有 5:0 全胜才到 p<0.05；4:1 是 0.19。

### 比数量更麻烦的一条

七个簇全部来自 `cron-brief-1789477249362` 一次运行——同一天的新闻分布、同一批源、
同一套聚类参数、同一次抓取的噪声。名义 n=7，实际更接近「一天的快照被切成七块」。
**扩样本不是多抓几个簇，是要跨日期、跨聚类运行取。**
瓶颈也不在判官成本（零 API、十分钟一轮），在于每个新簇都要人工按标题标杂质、且重跑各臂要能用的 LLM key。
