---
{
  "id": "measure-workers-ai-concurrency-capacity",
  "type": "lesson",
  "title": "Workers AI 的两条硬上限：24 路并发被拒（3046），3040 容量事件实测持续约 8 分钟",
  "date": "2026-09-13",
  "status": "recorded",
  "tasks": ["提高链路健壮性", "降低报告层成本"],
  "scope": "report-v3 整链跑在 Workers AI（glm-4.7-flash）上的两次真实事故；并发读数为 2026-09-12 一次整链跑，容量读数为 2026-09-13 一次事件。各一例，不是压测曲线，不知道 12 与 24 之间的拐点在哪",
  "source": "services/meridian-ai-worker/src/services/report-v3.ts 的 CONCURRENCY 与 TRANSPORT_RETRIES 注释（已于 2026-09-22 随清理删除；读数仅存于本节点）",
  "conditions": [
    "模型为 glm-4.7-flash，经 Workers AI；换模型或换账户配额后上限未知",
    "一个 14–16 篇的簇约 50–80 次调用、一分钟上下——并发是这条链的主要约束面，不是偶发",
    "report-v3 当时的 phase 配置：glm-4.7-flash，temperature 0.1，maxTokens 16384，skipCache true，frequencyPenalty 0.2，callIndex 基数 900（写作层 700 / 标题 690）"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {
      "type": "supports",
      "to": "measure-retry-signature-gap",
      "attributes": {"scope": "即使错误串匹配上了 3040，原来的重试深度（2 次、4/8 秒）也扛不住分钟级容量事件——签名匹配之外，退避深度同样要按实测事件时长定"}
    }
  ],
  "kind": "observation",
  "invalidates_when": "Workers AI 侧配额或调度改变，或换掉 glm-4.7-flash；出现新的并发/时长实测即取代本条"
}
---

## 并发上限：12 路健康，24 路被拒

生产形状是 **backend 侧 4 个簇并行 × report-v3 内部 3 路 = 12 路**，健康。

2026-09-12 整链跑在 **6×4 = 24 路**时，Workers AI 开始回 `3046: Request timeout`。
**注意归因：不是我们这边超时，是它拒绝。** 把 3046 读成「网络慢/超时设短了」会把人引向调
timeout，而真正要调的是并发度。

12 与 24 之间的拐点没测过。

## 容量事件时长：约 8 分钟

2026-09-13 实测 Workers AI 对 glm-4.7-flash 回了**约 8 分钟**的
`3040: Capacity temporarily exceeded`。

当时的重试策略是「2 次、4/8 秒」，**全程扛不住**——四个簇里三个整份作废。
加深到 4 次（退避 4s→8s→16s→32s，最坏多等 60 秒）才覆盖得住分钟级容量事件。
**健康时一次都不触发，所以这个深度的成本为零**——退避深度不是需要权衡的参数，
只要事件是分钟级的，浅退避就是白扛。
