# Meridian 项目代码统计工具

本目录包含了用于分析 Meridian 项目代码库的统计工具，帮助评估项目规模和技术分布。

## 🛠️ 可用工具

### 代码库分析工具 (推荐)
```bash
# 完整的代码库分析，包含详细模块和文件类型统计
node scripts/analyze-codebase.js
```

**特点:**
- 精确的业务文件识别和分类
- 按模块和文件类型的详细分析
- 排除所有构建产物和依赖文件
- 生成专业的分析报告

### 分析报告文档
- `scripts/codebase-summary.md` - 完整的代码库分析报告

## 📊 最新统计结果

### 核心数据 (截至 2025年6月18日)
- **业务文件总数**: 284 个
- **有效代码行数**: 76,546 行  
- **项目规模**: 大型项目

### 模块分布
1. **项目文档** (31.7%) - 24,303 行
2. **后端服务** (30.0%) - 22,935 行
3. **AI Worker 服务** (17.5%) - 13,420 行
4. **ML 服务** (7.5%) - 5,712 行
5. **前端应用** (3.4%) - 2,639 行

### 技术栈分布
- **TypeScript**: 30.4% (23,246 行)
- **文档**: 29.2% (22,355 行)
- **测试**: 8.9% (6,817 行)
- **Python**: 5.6% (4,301 行)

## 🔍 分析方法

### 包含的文件类型
- 源代码: `.ts`, `.js`, `.py`, `.vue`, `.tsx`, `.jsx`
- 配置文件: `.json`, `.yaml`, `.yml`, `.toml`, `.jsonc`
- 文档文件: `.md`, `.txt`
- 脚本文件: `.sh`, `.sql`
- 测试文件: `*.test.*`, `*.spec.*`

### 排除的内容
- 依赖目录: `node_modules`, `__pycache__`, `.venv`
- 构建输出: `dist`, `build`, `.nuxt`, `.output`
- 锁文件: `package-lock.json`, `pnpm-lock.yaml`, `uv.lock`
- 二进制文件: 图片、压缩包等
- 自动生成: 数据库迁移、meta 文件

## 🎯 使用建议

### 定期统计
建议每个开发迭代周期运行一次统计，跟踪项目增长：

```bash
# 生成当前统计并保存
node scripts/analyze-codebase.js > "stats_$(date +%Y%m%d).txt"
```

### 代码质量评估
结合统计数据评估项目健康度：
- 文档覆盖率应保持在 25% 以上
- 测试覆盖率应保持在 8% 以上  
- 单个模块不超过 30K 行代码

### 重构决策
当某个模块超过以下阈值时考虑重构：
- 单个服务超过 25,000 行
- 文件数超过 100 个
- 单个文件超过 1,000 行

## 🔧 自定义配置

### 修改文件类型
编辑 `analyze-codebase.js` 中的 `BUSINESS_EXTENSIONS`:

```javascript
const BUSINESS_EXTENSIONS = new Set([
  '.ts', '.js', '.py', '.vue',  // 源代码
  '.json', '.yaml', '.md',      // 配置和文档
  // 添加新的文件类型...
]);
```

### 调整排除规则
修改 `EXCLUDED_DIRS` 和 `EXCLUDED_FILES` 来自定义排除规则。

## 📈 项目规模评估

- **小型项目**: < 10,000 行
- **中型项目**: 10,000 - 50,000 行  
- **大型项目**: 50,000 - 200,000 行 ← **Meridian 当前规模**
- **超大型项目**: > 200,000 行

---

*这些工具帮助维护项目代码质量，支持技术决策和架构演进。* 