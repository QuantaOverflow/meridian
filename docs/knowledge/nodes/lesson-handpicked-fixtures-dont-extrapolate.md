---
{
  "id": "lesson-handpicked-fixtures-dont-extrapolate",
  "type": "lesson",
  "title": "按难度手挑的 7 簇只能加速迭代,比例不能外推到生产",
  "date": "2026-09-20",
  "status": "recorded",
  "tasks": ["设计验收门", "演化组合架构"],
  "scope": "fixtures-r94 的 7 簇(4 个按难度挑的难例)对比 prod-0919 的 25 簇(当天全部选中簇)",
  "source": "docs/knowledge/nodes/experiment-prod-day-real-distribution.md",
  "conditions": ["两套数据用的是同一个臂、同一批判官口径"],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "supersedes", "to": "lesson-dev-winner-fails-heldout", "attributes": {"scope": "把「dev→heldout 排序会翻」推进到「手挑集合→真实分布,比例本身不可外推」;前者论据仍成立"}}
  ],
  "kind": "diagnostic_observation",
  "invalidates_when": "手挑集合按真实分布做了分层抽样,并验证过各层比例与生产一致"
}
---

7 簇里 4 个是按难度挑进来的(题材袋 c43、超大题材袋 c51、少数派标题 c37、受污染 c36),
难例占一大半;生产真实一天里这类占三分之一。**在手挑集合上得到的任何比例,方向和数值都会偏。**

这一轮的具体表现:
- 在 7 簇上我只肉眼挑可疑句,报了 4.6% 的「下限」;真实一天逐句核是 6.5% 读者可见 + 22% 出处挂错。
  不是「真实分布更差」,是**手挑集合上从没量准过**。
- 反过来,简单簇在手挑集合里几乎不存在:真实一天里 c14 三次运行零缺陷、c12/c19 各只有 1 句。
  失败率随簇形态差异巨大,不分层看就是一锅粥。

**可操作**:手挑集合只用来快速迭代(跑得快、难例密度高、能快速暴露新改动的破绽);
**上线与否只看不挑选的一整天**,并按簇形态分层报。
