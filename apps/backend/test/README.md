# Meridian Backend 测试指南

## 测试概述

本项目使用 Vitest 和 @cloudflare/vitest-pool-workers 进行 Cloudflare Workers 环境的测试。

## 测试结构

### 主要测试文件

- `lib/cluster-blocks.spec.ts` - 聚类分块测试
- `golden/golden.spec.ts` - 简报链路纯函数的 golden 快照（见下节）

### Golden 快照（`golden/`）

characterization test：给简报 workflow 在 LLM 步之间调用的纯函数喂一份固定的生产形状输入，
把完整输出存成 JSON，任何差异都失败。Oracle = 写快照那天的输出，不判断对错，只拦「重构改了行为」。

- `fixtures/cron-brief-1790168539876.json` — 一期生产 run（report 104，39 块 177 篇），只读 SELECT 取自生产 Neon；
  只有 id / 标题 / url / 发布时间 / 源，**不含正文**。来源与裁剪说明在文件的 `provenance` 字段
- `cases.ts` — 每个 case 一个零参数函数：固定输入 → 真实 src 代码 → 输出。不许 mock、不许 `Date.now`/随机
- `__golden__/<case>.json` — 快照；`golden.spec.ts` 逐个 `toEqual` 比对
- 覆盖：storyline（dominantEntity / blockImportance）、story-dedup（pickSpreadArticles）、
  cluster-blocks（planBlocksFromJudgements / assembleBlocks）、story-ranking、brief-v3（assignTiers / renderBriefV3）、
  utils（generateSearchText）、extraction-quality（looksLikeExtractionFailure）

行为是**有意**改的，才重写快照（workers pool 里不能写盘，所以写盘在 node 脚本里）：

```bash
cd apps/backend
UPDATE_GOLDEN=1 npx tsx test/golden/update-golden.ts            # 全部
UPDATE_GOLDEN=1 npx tsx test/golden/update-golden.ts briefV3    # 单个 case
```

不带 `UPDATE_GOLDEN=1` 脚本拒绝执行（退出码 2）。重写后看 `git diff test/golden/__golden__`，把变化的理由写进 commit。
新增 case：在 `cases.ts` 加函数 → 跑上面的脚本 → 在 `golden.spec.ts` 的 `GOLDEN` 表里 import 新文件。

### 单测（`lib/`）

- `lib/cluster-blocks.spec.ts`：`planBlocksFromJudgements` / `assembleBlocks` 的行为（判定失败不丢块、NO_EVENT 只标记、30 篇上限、跨簇同名合并等）

### 数据库（`lib/source-pause.spec.ts`、`lib/save-brief-report.spec.ts`）

源暂停/恢复的测试走真实路由 + 真实 DO + **本机** Postgres 测试库（测试会清空 `sources`，非 localhost 的地址直接拒绝）。
没设 `BACKEND_TEST_DATABASE_URL` 时该文件直接报错，不静默跳过。一次性准备：

```bash
createdb meridian_backend_test
DATABASE_URL=postgresql://<user>@localhost:5432/meridian_backend_test pnpm -F @meridian/database migrate
```

连接串必须带密码（miniflare 的 Hyperdrive 校验要求）；本机 trust 认证时随便填一个即可。改 schema 后对它重跑 migrate。

## 配置文件

### vitest.config.ts
- 使用 @cloudflare/vitest-pool-workers
- 禁用文件并行执行，并开 `singleWorker`（否则多个测试文件一起跑时 workerd 起不来，原因见配置注释）

### wrangler.test.jsonc
- 测试专用的 Wrangler 配置
- 包含必要的 Durable Objects migrations
- 简化的绑定配置以避免冲突

## 运行测试

```bash
BACKEND_TEST_DATABASE_URL=postgresql://<user>:<pw>@localhost:5432/meridian_backend_test \
pnpm -F @meridian/backend test                                   # 全部（vitest run）
pnpm -F @meridian/backend test test/lib/cluster-blocks.spec.ts     # 单个文件
```

全链路的录像重放不在 vitest 里，见 [`replay/README.md`](replay/README.md)。

## 测试策略

由于 Cloudflare Workers 测试环境的限制，我们采用以下策略：

1. **顺序执行**: 禁用并行执行，确保测试稳定性
2. **简化配置**: 最小化绑定配置，减少启动错误

## 故障排除

### 常见问题

1. **兼容性日期错误**: 确保使用支持的日期 (2025-04-17)
2. **Durable Objects 错误**: 确保配置了正确的 migrations

### 测试最佳实践

1. 保持测试具有确定性和可重复性
2. 使用模拟替代复杂的实际绑定
3. 测试核心业务逻辑而非基础设施 