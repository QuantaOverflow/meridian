---
{
  "id": "lesson-storyline-filter-holds-on-superbag",
  "type": "lesson",
  "title": "主线筛选在 41% 杂质的超级袋上没把正题筛掉：剔 54/116 篇，句数 50→49、次层覆盖反而更高",
  "date": "2026-09-19",
  "status": "recorded",
  "tasks": ["演化组合架构"],
  "scope": "c51 china（116 篇、48 篇杂质 = 41%）单簇;c28（13% 杂质）同轮无剔除压力。**heldout 已被这一轮消耗**",
  "source": "docs/knowledge/nodes/experiment-heldout-replacement-candidate.md",
  "conditions": [
    "对照是同一基座同一轮:direct-raw(不筛)vs direct-raw-routed-storyline(筛),盲判",
    "c51 检索缺口 24–33%,正确性读数偏高,但对两臂同向"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "cautions", "to": "mechanism-dominant-storyline-filter", "attributes": {"scope": "把 limits 里「未在 heldout 上验」这条解掉,但只有 c51 一簇的 n=1 证据"}}
  ],
  "kind": "mechanism_attribution",
  "invalidates_when": "在跨日期的新超级袋上重测,筛选后核心层或次层覆盖低于不筛"
}
---

[[mechanism-dominant-storyline-filter]] 此前的 limits 写着「未在 heldout 上验」,
且实测精度高、**召回随簇增大而降**（c36 88%/78%），据此担心「大簇会丢掉一部分正题文章」。

**c51 上这个担心没有兑现**：

| | direct-raw（不筛） | routed-storyline（筛） |
|---|---|---|
| 进窗口的文章 | 116 篇 | **62 篇**（剔 54） |
| 成稿句数 | 50 | **49** |
| 核心层覆盖 | 2/2 | 2/2 |
| 次层覆盖 | 11/20 | **12/20** |
| 耗时 | 173.5s | **109.7s**（省 37%） |
| 硬错 / 失真 | 2 / 2 | **1 / 0** |

**剔掉将近一半的输入，产出只少一句，覆盖还略高，错误更少，耗时省三分之七。**

机制说明：被剔掉的是不属于主导成分的文章，而覆盖率的基准（事件清单）已经去过杂质，
所以剔掉的那批本来也不贡献覆盖分子。省下来的窗口预算落在正题上。

**限界**：单簇证据，n=1。c28（13% 杂质）那一簇剔除压力小，提供不了独立佐证。
