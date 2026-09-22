---
{
  "id": "measure-story-merge-threshold-094",
  "type": "lesson",
  "title": "故事归并阈值 0.94 的来历与它的天花板：94 条人工金标标定（文件已丢失），余弦仍分不开真假，两条组只能交给 LLM 确认",
  "date": "2026-08-30",
  "status": "recorded",
  "tasks": ["改去重", "治故事过拆"],
  "scope": "判据为 brief_stories.centroid（成员文章 embedding 均值，聚类时已算好）；标定样本为 94 条人工金标、5 个簇，标定时用的还是单链聚合。**那批金标文件已丢失**，本节点是唯一留存的转述",
  "source": "apps/backend/src/lib/core/story-dedup.ts 头注释（已于 2026-09-22 前后随清理删除）",
  "conditions": [
    "阈值作用在故事质心之间，不是在单句事件描述之间——与 lesson-cosine-cannot-detect-duplicate-events 是不同层但同一形状",
    "标定时的聚合方式是单链；改全链后阈值未重标（见 lesson-single-link-merge-falsified）",
    "5 个簇里 4 个与金标逐条相同——这是小样本上的吻合，不是精度"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "supports",
      "to": "lesson-cosine-cannot-detect-duplicate-events",
      "attributes": {"scope": "同一失败形状在故事质心层（0.94）复现：真重复与非重复的余弦交错排列，调阈值调不动"}
    }
  ],
  "kind": "observation",
  "invalidates_when": "换 embedding 模型或改用「共享 articleId + 数字/实体硬特征」做判据；或补出新的人工金标重新标定"
}
---

## 阈值 0.94 怎么来的

拿 **94 条人工金标**校准出 0.94。5 个簇里 4 个与金标**逐条相同**，
且顺手把误入尼泊尔簇的津巴布韦车祸孤立了出来。

**⚠️ 那批 94 条金标文件已丢失**（原注释自陈）。这个阈值现在没有可复现的标定依据——
要重标必须重新造金标。这也是本轮抢救这批读数的直接理由：这个仓库已经丢过一次东西。

## 余弦分不开真假

两条一组的合并只靠一条边支撑，而那条边的分数**交错排列**：

| 对 | cos | 该不该合 |
|---|---:|---|
| 纳根德拉辞职 | 0.9579 | 该合 |
| **基辅袭击 vs 泽连斯基无人机计划** | **0.9445** | **不该合** |
| 科伦坡测试赛 | 0.9423 | 该合 |

不该合的那条夹在两条该合的中间——**没有任何阈值能把这三行分开**。

**LLM importance 差也无效**：尼日尔兵变那对差 4 却该合，基辅那对差 3 却不该合。

## 因此的处置

**两条组交给 LLM 确认**（在起标题那次调用里顺便做，**零增量成本**），
**≥3 条的组不确认**。后者的依据只在全链聚合下才成立，且仍有已知缺口，
见 [[lesson-single-link-merge-falsified]]。
