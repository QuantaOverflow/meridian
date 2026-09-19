---
{
  "id": "lesson-judge-needs-alignment",
  "type": "lesson",
  "title": "没与人工对齐的判官把缺陷数虚高 4 倍——混淆「出处挂错」与「编造」",
  "date": "2026-09-20",
  "status": "recorded",
  "tasks": ["设计验收门"],
  "scope": "2026-09-20 三个临时 sonnet 判官判 51 篇 248 句;第二遍分类由两个独立 agent 各跑一次",
  "source": "docs/knowledge/nodes/experiment-prod-day-real-distribution.md",
  "conditions": ["判官 prompt 是临时写的,没有金标、没有一致率、不在指纹机制内"],
  "evidence_origin": "local_record",
  "relations": [],
  "kind": "failure_mode",
  "invalidates_when": "判官在 ≥30 条人工标注上量过真阳率/真阴率,且比例与人工一致"
}
---

判官标了 72 条「不合格」,逐条回查后**只有 16 条(22%)是读者可见的真错**,其余 55 条是
「事实在簇内别处有原文、只是被引的那句没写到」。两者的修法完全不同:一个要换模型,一个写代码补出处。

**根因是证据范围没写死**:判官被要求「只拿被引的那句判」,于是把所有「这句撑不住」都归成编造。
它自己也判错过——c5「当地男子把猫送到庇护所」被判为与原文矛盾,而同一篇文章里就有这句话。

**做成机制**(`judges/<axis>.md`):`citation-support` 只许读被引的那句,其余四轴必须读全簇,
两轴的唯一区别就是证据范围;每份规格都写死这一条并附上本次的 4 倍虚高作为理由。

**另一个同期失败**:一个 agent 自报完成、输出文件根本没落盘,报的比例差点被直接采用。
现在由 `collect-verdicts.mjs` 拿退出码拦(文件、schema、覆盖、promptId 四项),不过就不采用。

**可操作**:任何新判官进对比表之前,先在 ≥30 条人工标注上量真阳率/真阴率;
没量过的判官,其比例只能当量级参考。
