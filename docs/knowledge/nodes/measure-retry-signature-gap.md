---
{
  "id": "measure-retry-signature-gap",
  "title": "重试只认 3040/3046，连接层故障（Network connection lost / aborted）吃不住",
  "date": "2026-09-14",
  "status": "live",
  "source": "apps/backend/prototypes/cost-split/out/REPORT.md",
  "invalidates_when": "重试判据改成按「是否拿到有效响应」而不是按错误串匹配",
  "type": "lesson",
  "tasks": [
    "提高链路健壮性",
    "降低报告层成本"
  ],
  "scope": "仅限原节点正文与 source 所述模型、样本、目标及评测口径；未记录的条件未知",
  "conditions": [],
  "evidence_origin": "local_record",
  "relations": [],
  "legacy_type": "measurement",
  "legacy_relations": {},
  "kind": "observation"
}
---
实测到第三种故障签名：本地 `wrangler dev` 出现持续 10+ 分钟的
`Workers AI binding failed: Network connection lost` / `This operation was aborted`，
与 Workers AI 侧的 `3040 Capacity` / `3046 Timeout` **是不同的错误**。

两个后果：① 只按 3040/3046 匹配的重试逻辑对它完全不生效；② 这类连接层故障**加大重试次数也没用**
（补跑 5 次全部耗尽），需要的是等窗口过去。生产的报告层重试若沿用同一套专项匹配，会一样吃不住——
建议改成「没拿到有效响应就退避重试」，而不是匹配特定错误串。
