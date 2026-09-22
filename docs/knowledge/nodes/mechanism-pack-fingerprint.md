---
{
  "id": "mechanism-pack-fingerprint",
  "type": "mechanism",
  "title": "判定包指纹：把「判据变了旧读数作废」从 prose 变成退出码",
  "date": "2026-09-19",
  "status": "candidate",
  "tasks": ["设计验收门"],
  "scope": "cluster-to-brief 慢档；已随一次真实的守则变更跑通（6 份旧判定被自动隔离）",
  "source": "eval/cluster-to-brief/scorer-id.mjs、build-judge-pack.mjs、score-slow.mjs、scratch/selftest-slow.mjs",
  "conditions": [
    "grading instructions 必须抽成独立模块才算得出指纹 —— build-judge-pack.mjs 是脚本、有顶层副作用",
    "自测覆盖三种失效：缺指纹 / 包被改过 / 尺改了但包没重建，期望 exit 2"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "justified_by", "to": "lesson-scorer-steers-search"}
  ],
  "kind": "method",
  "input": "判定包 markdown、grading instructions 模块、retrieval 实现、topK、判官模型名",
  "output": "packId（包内容哈希）、scorerSrcId（守则+检索+旋钮哈希）、judgeModel；写进 judge-pack meta",
  "limits": "只覆盖慢档。`score-slow.mjs` **不在指纹里**——判定的有效性取决于判官看到了什么，而汇总每次都从 verdict 重算，算进去会让「改一行汇总逻辑」作废掉一批还有效的判定。judgeModel 靠环境变量记录，没设时默认 opus，这一段仍是约定而非强制。快档（verify.mjs）没有对应机制。",
  "invalidates_when": "出现一种改动会改变判定结果却不改变 packId 与 scorerSrcId"
}
---

CONTEXT.md 写着「实现层中途不得改判据；判据变了就是新的一把尺，旧读数作废」。
在 2026-09-19 之前这只是一句 prose——换了证据通道之后全靠人记得把旧 verdict 移走。
**记不住的那一次，新旧读数会混在同一张表里比较，而且不报错**：score-slow 照常算出一个看着正常的数。

两个指纹各管一种失效：

| 指纹 | 是什么 | 抓什么 |
|---|---|---|
| `packId` | 判定包 markdown 的哈希 | 判官到底看到了什么。守则改了、清单重抽了、检索变了、成稿变了 —— 包一变旧判定就不对应这份材料 |
| `scorerSrcId` | 守则 + 检索实现 + topK 的哈希 | 「尺改了但判定包没重建」。这时包内容还是旧的，packId 对得上，只有源码指纹能发现 |

两处动作：重建判定包时包内容变了就把旧 verdict 自动搬到 `_stale-pack-<旧 id>/`；
score-slow 读不到指纹或对不上就 exit 2。

**指纹从内容算，不手写版本号** —— 手写的会忘记改，而忘记改恰好等于关掉这道闸。

**judgeModel 也是 scorer 的一部分**：opus 判的格子与 sonnet 判的格子放进同一张 frontier 表
不是「有噪声」，是不可比。`frontier.mjs` 断言同一轮全部格子的 judgeModel 一致，不一致 exit 2。
