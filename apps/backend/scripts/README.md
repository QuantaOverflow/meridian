# Meridian Backend 运维脚本

本目录是手动运行的运维脚本，不接入任何测试 runner。

## 跨期线索归并 - `assign-story-clusters.ts`

**功能**：把历史 `brief_stories` 按时间顺序归并成跨期线索（`story_clusters`）。归并逻辑与生产工作流共用
`src/lib/story-clusters.ts`；不调 LLM，只用库里已有的 embedding，可反复跑。

**使用方法**（仓库根目录）：
```bash
DATABASE_URL=... pnpm -C packages/database exec tsx ../../apps/backend/scripts/assign-story-clusters.ts
# 可选：--reset（先清空再重跑）、--threshold 0.96、--lookback 21
```

`DATABASE_URL` 必填（也认 `NUXT_DATABASE_URL`），无默认值。
