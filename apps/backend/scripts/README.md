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

## 补 run 汇总 - `backfill-ops-summary.ts`

**功能**：给最近 30 天、`ops_summary` 为空的生产运行（`cron-brief-%`）补运维台读的那份 run 汇总。算法与 workflow 结束时那一步共用
`src/lib/ops/run-summary.ts`；R2 经 Cloudflare REST API 只读。一次性脚本，**默认 dry-run**，加 `--write` 才写库。
读不到的 run 跳过、保持 null；补出来的 `degradedReasons` 恒为空（降级原因当时只进了日志）。

**使用方法**（仓库根目录）：
```bash
DATABASE_URL=... CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
  pnpm -C packages/database exec tsx ../../apps/backend/scripts/backfill-ops-summary.ts
# 可选：--write（写库）、--days 30、--run <workflowId>（只算指定 run，可重复；不加 --write 时不连库）
```

R2 的 REST API 全账号限 1200 次 / 5 分钟，脚本匀速发请求：写作–核查循环上线后的 run 一期约 400 条调用记录，约 2 分钟一期。

## 回填简报块 - `backfill-brief-blocks.ts`

**功能**：给往期简报补表 `brief_blocks`（新出的一期在保存简报时就写，见 `src/lib/save-brief-report.ts`；为什么有这张表见 `docs/adr/0014-brief-blocks-table.md`）。
依据是每期的 brief-v3 记录：写出来的块按 `clusterId` 对回故事，整期回填或整期跳过并报原因。标题与正文的取法、落库的写法与保存简报共用。
块上的落点国家、涉及国家与实体（国家页、实体页按它查）写块时按成员文章算，重跑即刷新；跳过的期已有的块只重算这几列。
**默认 dry-run**，加 `--write` 才写库；每期一个事务里先删后写，可重跑。R2 经 Cloudflare REST API 只读。
目标库只认本机与 staging（主机名与 `STAGING_DATABASE_URL` 相同，取自环境变量或根 `.staging.env`），别的一律当生产拒绝，要加 `--production`。

**使用方法**（仓库根目录）：
```bash
DATABASE_URL=... CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
  pnpm -C packages/database exec tsx ../../apps/backend/scripts/backfill-brief-blocks.ts --bucket meridian-articles-prod
# 可选：--write（写库）、--since 2026-09-01、--production
```

往期的记录只在生产 bucket。退出码 1 = 出错，或写完后库里的块数与记录的成功块数对不上。

