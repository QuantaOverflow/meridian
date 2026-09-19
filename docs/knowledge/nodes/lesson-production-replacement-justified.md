---
{
  "id": "lesson-production-replacement-justified",
  "type": "lesson",
  "title": "替换生产的方向成立：差距是量级的,不是边际的;但延迟风险未测",
  "date": "2026-09-19",
  "status": "recorded",
  "tasks": ["演化组合架构"],
  "scope": "dev 五簇、同一天快照;结论限于「方向成立」,不等于「可以上线」",
  "source": "docs/knowledge/nodes/experiment-production-baseline-same-scorer.md",
  "conditions": [
    "唯一一次原型与被替换对象在同一把尺下的比较",
    "生产未盲判;杂质率与冗余对生产是空值"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "cautions", "to": "attempt-routed-storyline-direct-raw", "attributes": {"scope": "读全量原文的延迟在生产规模上未测 —— c36 82 篇已逼近 300 秒超时线,而生产当时是截断到 30 篇跑的"}}
  ],
  "kind": "diagnostic_observation",
  "invalidates_when": "在跨日期簇上重测,或全量读在 ≥100 篇的簇上撞超时"
}
---

**差距的量级**(同一把尺,dev 五簇):

| | 生产 r94 | direct-raw-routed-storyline |
|---|---|---|
| 致命错 | **1** | 0 |
| 核心层覆盖 | 47.6% | **88.9%** |
| 出处可回溯 | **0/45** | 90/118 |
| 快档 | **5/5 不合格** | 全过 |
| 慢档 | 3/5 不合格 | 全过 |

**这不是几个百分点的差异**,所以即使带着「生产未盲判」这个已知偏差,方向仍然成立。

### 但「方向成立」≠「可以上线」,还缺三样

1. **跨日期证据**。七个簇全部来自 `cron-brief-1789477249362` 一次运行 —— 同一天的新闻分布、
   同一批源、同一套聚类参数、同一次抓取噪声。名义 n=7,实际更接近「一天的快照被切成七块」。
   见 [[lesson-small-sample-flips]]:三簇上看到的机制差异,补到五簇就消失了。
2. **生产规模的延迟**。**这是最可能致命的一条**:原型的架构优势来自**读全量原文**
   (生产截断到 30 篇,c51 因此丢了 86/116 = 74%),但 c36 的 82 篇 264k 字符
   已逼近生产实测的超时线(91 篇 283k → 300 秒硬失败),而 c51 有 116 篇。
   **全量读如果在大簇上超时,架构优势就无法兑现。**
3. **接进 backend**。原型是读 fixture 的 node 脚本,生产是 CF Worker + Workflow + R2 + DB,
   输出契约也不同(原型产 `{blocks:[{title, sentences:[{text, sources}]}]}`)。

### 顺序建议

**延迟压测排在扩样本之前** —— 它便宜、且坏消息能直接砍掉后面全部投入。
