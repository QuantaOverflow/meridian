---
{
  "id": "mechanism-dominant-storyline-filter",
  "type": "mechanism",
  "title": "按合并后的主导主线筛文章，再交给下游生成",
  "date": "2026-09-19",
  "status": "candidate",
  "tasks": ["演化组合架构"],
  "scope": "dev 五簇上与人工杂质标注对照；2026-09-19 在 heldout 的 c51(116 篇/41% 杂质)上端到端验过一次；未验跨日期语料",
  "source": "eval/cluster-to-brief/arms/structure-router/run.mjs（mergeStorylines/route）+ out/structure-router/structure-c<id>.json",
  "conditions": [
    "必须用 e5 合并后的 canonicalStorylineKey，不是合并前的 storylineKey：后者在 c36 上只匹配 8 篇，而真实主导成分是 56 篇",
    "主导成分少于 2 篇时跳过筛选，不把簇筛空"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "justified_by", "to": "lesson-scorer-steers-search"}
  ],
  "kind": "component",
  "input": "簇内文章的事件签名（storylineKey/episodeKey/actors/action/place），经 e5 嵌入做连通分量合并",
  "output": "属于最大连通分量的那批 articleId",
  "limits": "与人工杂质标注对照（2026-09-19，dev 五簇）：c7 100%/100%、c1 100%/100%、c37 100%/100%、c43 96%/81%、c36 88%/78%（精度/召回）。精度高、召回随簇增大而降，大簇会丢掉一部分正题文章。只在杂质与主题**结构可分**时有效——c1 的科索沃组阁与瑞典组阁高度同构，它仍分开了，但这是单点证据，不能外推到所有同构杂质。2026-09-19 heldout 解掉了「召回随簇增大而降会丢正题」这条担心：c51(116 篇/41% 杂质)剔掉 54 篇后，成稿 50→49 句、次层覆盖 12/20 反而优于不筛的 11/20、耗时省 37%、硬错 2→1。但这是 n=1，只有 c51 一簇。",
  "invalidates_when": "在跨日期的新超级袋上，筛选后的核心层或次层覆盖低于不筛；或精度跌破 0.9"
}
---

从 `structure-router` 臂里提炼出来的第二个可复用件（第一个是[[mechanism-shape-triage]] 的路由门）。
两者可以分开用：路由门决定「这簇该不该写」，本机制决定「该写的话喂哪些文章进去」。

**用错字段会得到相反的结论。** 2026-09-19 首次测量时按合并前的 `storylineKey` 精确匹配，
c36 只选出 8 篇、召回 13%，据此判定「不可嫁接」；换成合并后的 `canonicalStorylineKey` 重测是 56 篇、
召回 78%。同一份数据、同一个机制，读错一个字段结论完全相反。

实测效果见 [[experiment-crossover-routed-storyline-dev]]：接到 direct-raw 上之后，
c1 的成稿杂质率从 42.4% 降到 0%，而句数从 33 降到 16（structure-router 自己的 writer 只写 7 句）。
