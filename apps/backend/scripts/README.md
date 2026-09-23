# Meridian Backend 测试脚本指南

## 概述

本目录包含Meridian Backend系统的测试脚本，已经过精简优化，提供简洁高效的测试体验。

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

## 🚀 快速开始

### 环境准备

1. **启动Backend服务**
   ```bash
   cd apps/backend
   wrangler dev
   # 服务运行在 http://localhost:8787
   ```

2. **确保数据库运行**
   ```bash
   # PostgreSQL应该在运行且可访问
   export DATABASE_URL="postgresql://user:password@localhost:5432/meridian"
   ```

3. **设置API认证**
   ```bash
   # 在.dev.vars文件中设置
   API_TOKEN=localtest
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
| `DATABASE_URL` | PostgreSQL连接字符串 | `postgresql://postgres@localhost:5432/shiwenjie` |
| `API_TOKEN` | Backend API认证令牌 | `localtest` |

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

3. **认证失败**
   ```
   解决：检查.dev.vars文件中的API_TOKEN设置
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
└── README.md           # 使用指南（本文件）
```

---

*这些脚本帮助确保Meridian Backend的稳定性和可靠性。建议在每次重要修改后运行相应的测试。*
