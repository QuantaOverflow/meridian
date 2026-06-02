# Meridian Backend 测试脚本指南

## 概述

本目录包含Meridian Backend系统的测试脚本，已经过精简优化，提供简洁高效的测试体验。

## 🛠️ 可用脚本

### 1. 统一端到端测试 - `e2e-test.js`

**功能**：支持两种模式的端到端测试
- **简化模式**：使用现有RSS源进行测试（推荐）
- **完整模式**：创建新源，完整流程测试，完成后清理

**使用方法**：
```bash
# 简化模式（默认）- 使用第一个可用RSS源
node apps/backend/scripts/e2e-test.js

# 简化模式 - 指定RSS源ID
node apps/backend/scripts/e2e-test.js simple 1

# 完整模式 - 创建新源并测试
node apps/backend/scripts/e2e-test.js full
```

**测试流程**：
1. 准备测试源（查找现有源 或 创建新源）
2. 确保Durable Object初始化
3. 触发RSS抓取和文章处理
4. 监控处理进度
5. 验证结果
6. 清理（仅完整模式）

### 2. 数据库监控 - `monitor-database.js`

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

### 3. 数据库统计 - `db-stats.sh`

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

### 4. 快速启动器 - `quick-test.sh`

**功能**：统一的测试启动器，整合所有测试功能

**使用方法**：
```bash
# 基本用法
./apps/backend/scripts/quick-test.sh [test_type] [source_id]

# 具体示例
./apps/backend/scripts/quick-test.sh simple        # 简化测试
./apps/backend/scripts/quick-test.sh simple 1      # 指定源ID测试
./apps/backend/scripts/quick-test.sh full          # 完整测试
./apps/backend/scripts/quick-test.sh monitor       # 启动监控
./apps/backend/scripts/quick-test.sh stats         # 显示统计
```

### 5. 测试数据生成 - `generate-fixtures.js`

**功能**：生成测试fixture数据

**使用方法**：
```bash
node apps/backend/scripts/generate-fixtures.js
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

### 推荐测试流程

1. **快速验证**
   ```bash
   ./apps/backend/scripts/quick-test.sh simple
   ```

2. **监控过程**（在另一个终端）
   ```bash
   ./apps/backend/scripts/quick-test.sh monitor
   ```

3. **查看统计**
   ```bash
   ./apps/backend/scripts/quick-test.sh stats
   ```

## 📊 测试场景

### 场景1：日常开发验证
```bash
# 快速验证系统功能
./apps/backend/scripts/quick-test.sh simple
```

### 场景2：功能完整测试
```bash
# 完整端到端验证
./apps/backend/scripts/quick-test.sh full
```

### 场景3：调试特定RSS源
```bash
# 测试指定源
./apps/backend/scripts/quick-test.sh simple 3

# 同时监控变化
./apps/backend/scripts/quick-test.sh monitor
```

### 场景4：系统状态检查
```bash
# 查看当前状态
./apps/backend/scripts/quick-test.sh stats
```

## 🔧 配置说明

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL连接字符串 | `postgresql://postgres@localhost:5432/shiwenjie` |
| `API_TOKEN` | Backend API认证令牌 | `localtest` |

### 测试配置

测试脚本中的配置可以通过修改 `CONFIG` 对象进行调整：

```javascript
const CONFIG = {
  BACKEND_URL: 'http://localhost:8787',
  API_TOKEN: 'localtest',
  POLLING_INTERVAL: 3000,  // 监控间隔(毫秒)
  MAX_WAIT_TIME: 180000,   // 最大等待时间(毫秒)
};
```

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

4. **没有RSS源**
   ```
   解决：使用完整模式或先手动创建RSS源
   ```

### 调试技巧

1. **查看详细日志**
   - 所有脚本提供详细的执行日志
   - 使用时间戳跟踪执行进度

2. **手动验证服务**
   ```bash
   # 检查API服务
   curl http://localhost:8787/ping
   
   # 检查RSS源
   curl -H "Authorization: Bearer localtest" http://localhost:8787/admin/sources
   ```

3. **分步测试**
   - 先运行统计查看当前状态
   - 再运行测试观察变化
   - 最后运行监控确认结果

## 📈 测试报告

### 自动生成报告

- 端到端测试会生成JSON格式的详细报告
- 报告包含：测试持续时间、各阶段执行时间、错误详情、数据库状态变化
- 报告文件格式：`test-report-{timestamp}.json`

### 成功指标

- ✅ RSS源识别或创建成功
- ✅ DO初始化完成
- ✅ RSS抓取触发成功
- ✅ 文章处理工作流执行
- ✅ 数据库状态正常变化

## 📁 文件结构

```
apps/backend/scripts/
├── e2e-test.js           # 统一端到端测试脚本
├── monitor-database.js   # 数据库实时监控
├── db-stats.sh          # 数据库统计概览
├── quick-test.sh        # 快速测试启动器
├── generate-fixtures.js # 测试数据生成器
└── README.md           # 使用指南（本文件）
```

## 🔄 精简说明

本测试套件已经过精简优化：

- **删除了重复功能**：合并了4个E2E测试脚本为1个
- **统一了接口**：所有功能通过`quick-test.sh`统一访问
- **简化了维护**：减少了文件数量，降低了维护复杂度
- **保持了功能**：所有原有功能都得到保留

---

*这些脚本帮助确保Meridian Backend的稳定性和可靠性。建议在每次重要修改后运行相应的测试。* 