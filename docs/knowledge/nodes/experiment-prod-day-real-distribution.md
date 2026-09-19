---
{
  "id": "experiment-prod-day-real-distribution",
  "type": "experiment",
  "title": "真实一天不挑选的 25 簇上跑 v6：读者可见错 6.5%、出处挂错 22%、路由门拒掉 32%",
  "date": "2026-09-20",
  "status": "recorded",
  "tasks": ["演化组合架构", "设计验收门"],
  "scope": "cron-brief-1789822849701(2026-09-19)当天 selected_for_intel 的 25 簇 818 篇;臂=direct-raw 路由门+主线筛选+最后一步写+exec 篇幅+按报道量必写+mech 修复;k=3;判官=sonnet subagent,未与人工标注对齐",
  "source": "scripts/eval/cluster-to-brief/datasets/prod-0919.json;判定与分类结果只在本地 scratchpad(未入 git)",
  "conditions": [
    "判官只拿成稿引用的那几句判,与慢档「证据由判官全簇检索」不是同一把尺,两者读数不可直接比",
    "判官未对齐,精确值不可信(见 lesson-judge-needs-alignment);量级可信",
    "c36 第一次运行有一个窗口连续三次校验失败,续跑补齐后才计入"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "yields", "to": "lesson-handpicked-fixtures-dont-extrapolate"},
    {"type": "yields", "to": "lesson-judge-needs-alignment"},
    {"type": "yields", "to": "lesson-run-variance-needs-epochs"}
  ],
  "kind": "prototype_evaluation",
  "outcome": "mixed",
  "inputs": "25 簇 818 篇全量原文(未按 30 篇截断);事件签名抽取 46 次调用;写作 17 簇 × 3 次",
  "evaluation": "快档机械判据(零 LLM) + 三个 sonnet 判官逐句对照被引原句 + 第二遍把每条 flag 分成「事实在簇内别处」「簇内根本没有」「只是关系编造」;后者两个独立 agent 跑出 55/8/8/1 与 55/9/7/1,一致",
  "result": "路由门拒 8/25(32%),人工核标题确认拒得对,全是杂项堆;写出来的 17 簇 × 3 = 51 篇 248 句:快档全绿(数字缺出处 3、引语 1、块内重复 7 对);判官 flag 72 句(29%),分类后**读者可见的错 16 句=6.5%**(编造事实 8、编造关系 8),**出处挂错 55 句=22%**(事实真但被引那句撑不住);整篇有读者可见错或混写的 20/51=39%;混写 12/51 集中在路由门放行的大簇",
  "cost": "Workers AI:签名 46 次 + 窗口约 330 次 + 写作 51 次;判官为 Claude subagent,零 API 费;墙钟约 2 小时",
  "record_completeness": "complete"
}
---

**第一次在不挑选的真实分布上量。** 之前四代都只在 7 个按难度手挑的簇上比。

### 两层错误必须分开

| | 句子 | 读者能不能看出来 | 修法 |
|---|---|---|---|
| 编造事实 8 + 编造关系 8 | 16/248 = **6.5%** | 能 | 换模型 / 写作层 |
| 出处挂错(事实在簇里是真的,被引那句撑不住) | 55/248 = **22%** | 看不出来 | 代码回查补出处 |

合成一个 29% 会把结论带偏:四分之三其实是引用没挂对,不是编造。

**典型的读者可见错**:c11「本次死亡人数超过 2023 年白沙瓦 101 人」(本次 21–31 人,方向写反)、
c3 三次运行都写「法律专家预测」(全簇无此消息源)、c25「Boris Johnson 受伤」(原文只说官员被疏散)。

### 路由门的读数

25 个簇拒掉 8 个(c6/c28/c34/c41/c50/c54/c57/c58),人工核了这 8 个簇的文章标题,**全是杂项堆**
(c58 183 篇里有枪支、莫迪生日、慕尼黑啤酒节、宝莱坞婚礼)。生产当天对这些簇照写不误,
简报里就有标题叫「India」「California」「Trump」「Delhi」的条目。

代价:每个袋子里通常藏着一两个真实小故事(休达驱赶移民、南海撞船、珀斯鲨鱼袭击),占 13–19%,
随袋子一起被拒。要捞回来得在上游把袋子拆成事件。
