# Meridian Backend 运维脚本

本目录是手动运行的运维脚本，不接入任何测试 runner。

## 🛠️ 可用脚本

### 1. 数据库监控 - `monitor-database.js`

**功能**：实时监控数据库状态，显示文章处理各阶段进度

**使用方法**：
```bash
node apps/backend/scripts/monitor-database.js
```

**监控内容**：
- 文章总数及状态分布
- RSS源状态和最后检查时间  
- 处理进度和失败统计
- 最近的文章活动

### 2. 数据库统计 - `db-stats.sh`

**功能**：快速显示数据库统计概览

**使用方法**：
```bash
./apps/backend/scripts/db-stats.sh
```

**统计内容**：
- 核心指标（源数量、文章数量、处理效率）
- 最近活动（7天内）
- 文章状态分布
- RSS源状态
- 问题诊断

### 3. 快速启动器 - `quick-test.sh`

**功能**：数据库监控与统计的统一启动器

**使用方法**：
```bash
# 基本用法
./apps/backend/scripts/quick-test.sh [test_type]

# 具体示例
./apps/backend/scripts/quick-test.sh monitor       # 启动监控
./apps/backend/scripts/quick-test.sh stats         # 显示统计（默认）
```

### 4. 跨期线索归并 - `assign-story-clusters.ts`

**功能**：把历史 `brief_stories` 按时间顺序归并成跨期线索（`story_clusters`）。归并逻辑与生产工作流共用
`src/lib/story-clusters.ts`；不调 LLM，只用库里已有的 embedding，可反复跑。

**使用方法**（仓库根目录）：
```bash
DATABASE_URL=... pnpm -C packages/database exec tsx ../../apps/backend/scripts/assign-story-clusters.ts
# 可选：--reset（先清空再重跑）、--threshold 0.96、--lookback 21
```

### 5. 补写读者摘要 - `backfill-tldr-prose.ts`

**功能**：给 `reports.tldr_prose` 为空的历史简报补写读者摘要，逐期调 ai-worker `/meridian/generate-brief-summary`
（真实 LLM 调用）。

**使用方法**（仓库根目录；先另开终端起 ai-worker，或把 `AI_WORKER_URL` 指向已部署的 worker）：
```bash
DATABASE_URL=... pnpm -C packages/database exec tsx ../../apps/backend/scripts/backfill-tldr-prose.ts
# 可选：--dry-run、--ids 70,71,72、--force；环境变量 AI_WORKER_URL（默认 http://localhost:8787）、CONCURRENCY（默认 4）
```

## 🚀 快速开始

### 环境准备

1. **启动Backend服务**（只有 `quick-test.sh` 会检查它）
   ```bash
   pnpm -F @meridian/backend dev
   # 服务运行在 http://localhost:8787
   ```

2. **确保数据库运行**
   ```bash
   # PostgreSQL应该在运行且可访问
   export DATABASE_URL="postgresql://user:password@localhost:5432/meridian"
   ```

### 常用流程

1. **监控过程**（在另一个终端）
   ```bash
   ./apps/backend/scripts/quick-test.sh monitor
   ```

2. **查看统计**
   ```bash
   ./apps/backend/scripts/quick-test.sh stats
   ```

## 🔧 配置说明

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL连接字符串（两个 `.ts` 脚本也认 `NUXT_DATABASE_URL`） | `.sh`/`.js` 脚本默认 `postgresql://postgres@localhost:5432/shiwenjie`；`.ts` 脚本无默认，必填 |
| `AI_WORKER_URL` | `backfill-tldr-prose.ts` 调用的 ai-worker | `http://localhost:8787` |

## 🐛 故障排除

### 常见问题

1. **数据库连接失败**
   ```
   解决：检查PostgreSQL服务状态和DATABASE_URL配置
   ```

2. **Backend服务不可用**
   ```
   解决：确保 wrangler dev 在localhost:8787运行
   ```

### 调试技巧

1. **查看详细日志**
   - 所有脚本提供详细的执行日志
   - 使用时间戳跟踪执行进度

2. **手动验证服务**
   ```bash
   # 检查API服务
   curl http://localhost:8787/ping
   ```

## 📁 文件结构

```
apps/backend/scripts/
├── monitor-database.js   # 数据库实时监控
├── db-stats.sh          # 数据库统计概览
├── quick-test.sh        # 快速测试启动器
├── assign-story-clusters.ts  # 跨期线索归并
├── backfill-tldr-prose.ts    # 补写读者摘要
└── README.md           # 使用指南（本文件）
```

